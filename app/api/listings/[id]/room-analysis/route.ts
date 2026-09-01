import { NextResponse } from "next/server"
import type Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { anthropicClient } from "@/lib/anthropic"
import { getUrls } from "@/lib/storage"
import { logicalPhotoIds } from "@/lib/hdr-groups"
import {
  parseRoomAnalysisResponse,
  roomAnalysisUserPrompt,
  ROOM_ANALYSIS_MAX_PHOTOS,
} from "@/lib/room-analysis"
import { buildRoomAnalysisSheets } from "@/lib/room-analysis-images"
import { ROOM_ANALYSIS_SYSTEM } from "@/lib/prompts"
import { ROOM_ANALYSIS_MODEL, roomAnalysisCostCents } from "@/config/models"

type AnalysisBody = { requestKey?: string }

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: listingId } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => null)) as AnalysisBody | null
  if (!body?.requestKey || !/^[0-9a-f-]{36}$/i.test(body.requestKey)) {
    return NextResponse.json({ error: "requestKey must be a UUID" }, { status: 400 })
  }
  const { data: listing } = await supabase.from("listings").select("id").eq("id", listingId).single()
  if (!listing) return NextResponse.json({ error: "listing not found" }, { status: 404 })

  const admin = createAdminClient()
  const { data: prior } = await admin
    .from("room_analysis_runs")
    .select("id, status, analyzed_photo_count, cost_cents, error")
    .eq("listing_id", listingId)
    .eq("request_key", body.requestKey)
    .maybeSingle()
  if (prior) return NextResponse.json({ run: prior, idempotent: true })

  const [{ data: photos }, { data: groups }, { data: members }, { data: rooms }] = await Promise.all([
    supabase.from("photos").select("id, storage_path, is_floor_plan, photo_role").eq("listing_id", listingId).order("created_at"),
    supabase.from("photo_groups").select("id, state, representative_photo_id").eq("listing_id", listingId).eq("state", "confirmed"),
    supabase.from("photo_group_members").select("group_id, photo_id, photo_groups!inner(listing_id)").eq("photo_groups.listing_id", listingId),
    supabase.from("rooms").select("id, name, room_type").eq("listing_id", listingId).order("name"),
  ])
  const memberIds = new Map<string, string[]>()
  for (const member of members ?? []) {
    const next = memberIds.get(member.group_id) ?? []
    next.push(member.photo_id)
    memberIds.set(member.group_id, next)
  }
  const logicalIds = logicalPhotoIds(photos ?? [], (groups ?? []).map((group) => ({
    representative_photo_id: group.representative_photo_id,
    members: memberIds.get(group.id) ?? [],
  })))
  if (!logicalIds.length) return NextResponse.json({ error: "Upload listing photos before analyzing rooms." }, { status: 400 })
  if (logicalIds.length > ROOM_ANALYSIS_MAX_PHOTOS) {
    return NextResponse.json({ error: `Room analysis supports up to ${ROOM_ANALYSIS_MAX_PHOTOS} photos at once.` }, { status: 400 })
  }

  const { data: run, error: runError } = await admin.from("room_analysis_runs").insert({
    listing_id: listingId,
    request_key: body.requestKey,
    status: "running",
    model: ROOM_ANALYSIS_MODEL.id,
    logical_photo_ids: logicalIds,
  }).select("id, status").single()
  if (runError || !run) {
    const { data: raced } = await admin.from("room_analysis_runs")
      .select("id, status, analyzed_photo_count, cost_cents, error")
      .eq("listing_id", listingId).eq("request_key", body.requestKey).maybeSingle()
    if (raced) return NextResponse.json({ run: raced, idempotent: true })
    return NextResponse.json({ error: "Could not start room analysis." }, { status: 500 })
  }

  const logicalPhotos = (photos ?? []).filter((photo) => logicalIds.includes(photo.id))
  const urls = await getUrls("originals", logicalPhotos.map((photo) => photo.storage_path))
  const availablePhotos = logicalPhotos.flatMap((photo) => urls[photo.storage_path] ? [{ id: photo.id, url: urls[photo.storage_path] }] : [])
  const missingUrlIds = logicalPhotos.filter((photo) => !urls[photo.storage_path]).map((photo) => photo.id)
  const { sheets, failedPhotoIds } = await buildRoomAnalysisSheets(availablePhotos)
  if (!sheets.length) {
    await admin.from("room_analysis_runs").update({
      status: "failed", error: "No listing photos could be read.", completed_at: new Date().toISOString(),
    }).eq("id", run.id)
    return NextResponse.json({ error: "No listing photos could be read. Your photos are unchanged." }, { status: 502 })
  }

  const unreadableIds = [...missingUrlIds, ...failedPhotoIds]
  const readableIds = availablePhotos.map((photo) => photo.id).filter((id) => !failedPhotoIds.includes(id))
  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: roomAnalysisUserPrompt(readableIds, (rooms ?? []).map((room) => ({ id: room.id, name: room.name, roomType: room.room_type }))) },
    ...sheets.flatMap((sheet, index): Anthropic.ContentBlockParam[] => [
      { type: "text", text: `Contact sheet ${index + 1}. Each tile is labeled Photo N matching the supplied order.` },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: sheet.toString("base64") } },
    ]),
  ]

  let response: Anthropic.Message
  try {
    response = await anthropicClient().messages.create({
      model: ROOM_ANALYSIS_MODEL.id,
      max_tokens: 12000,
      system: ROOM_ANALYSIS_SYSTEM,
      messages: [{ role: "user", content }],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Room analysis failed."
    await admin.from("room_analysis_runs").update({ status: "failed", error: message, completed_at: new Date().toISOString() }).eq("id", run.id)
    return NextResponse.json({ error: "Room analysis could not finish. Your photos are unchanged." }, { status: 502 })
  }

  const costCents = roomAnalysisCostCents(response.usage.input_tokens, response.usage.output_tokens)
  await admin.from("spend_ledger").insert({
    listing_id: listingId,
    room_analysis_run_id: run.id,
    model: ROOM_ANALYSIS_MODEL.id,
    cost_cents: costCents,
    kind: "interpreter",
    edit_type: "ROOM_ANALYSIS",
  })
  const text = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map((block) => block.text).join("")
  let parsed
  try {
    parsed = parseRoomAnalysisResponse(text, readableIds, (rooms ?? []).map((room) => room.id))
  } catch {
    await admin.from("room_analysis_runs").update({
      status: "failed", cost_cents: costCents, error: "The analysis response could not be read.", completed_at: new Date().toISOString(),
    }).eq("id", run.id)
    return NextResponse.json({ error: "Room analysis returned an unreadable result. Your photos are unchanged." }, { status: 502 })
  }

  if (!parsed.proposals.length) {
    await admin.from("room_analysis_runs").update({
      status: "failed", cost_cents: costCents, error: "No valid room proposals were returned.", completed_at: new Date().toISOString(),
    }).eq("id", run.id)
    return NextResponse.json({ error: "No usable room suggestions were returned. Your photos are unchanged." }, { status: 502 })
  }

  const rows = parsed.proposals.map((proposal) => ({
    run_id: run.id,
    listing_id: listingId,
    photo_id: proposal.photoId,
    proposed_room_type: proposal.roomType,
    proposed_room_name: proposal.roomName,
    proposed_room_id: proposal.existingRoomId,
    proposed_same_room_key: proposal.sameRoomKey,
    confidence: proposal.confidence,
    evidence: proposal.evidence,
    review_state: proposal.reviewState,
    is_current: false,
  }))
  const { error: insertError } = await admin.from("room_proposals").insert(rows)
  if (insertError) {
    await admin.from("room_analysis_runs").update({ status: "failed", cost_cents: costCents, error: "Could not save proposals.", completed_at: new Date().toISOString() }).eq("id", run.id)
    return NextResponse.json({ error: "Suggestions were analyzed but could not be saved. Your photos are unchanged." }, { status: 500 })
  }

  const { data: previous } = await admin.from("room_proposals").select("id").eq("listing_id", listingId).eq("is_current", true)
  const previousIds = (previous ?? []).map((proposal) => proposal.id)
  if (previousIds.length) await admin.from("room_proposals").update({ is_current: false }).in("id", previousIds)
  const { error: publishError } = await admin.from("room_proposals").update({ is_current: true }).eq("run_id", run.id)
  if (publishError) {
    if (previousIds.length) await admin.from("room_proposals").update({ is_current: true }).in("id", previousIds)
    await admin.from("room_analysis_runs").update({ status: "failed", cost_cents: costCents, error: "Could not publish proposals.", completed_at: new Date().toISOString() }).eq("id", run.id)
    return NextResponse.json({ error: "Suggestions could not be published. Your earlier organization is preserved." }, { status: 500 })
  }

  const missing = [...unreadableIds, ...parsed.missingPhotoIds]
  const partial = missing.length > 0 || parsed.rejected.length > 0
  const error = partial ? `${missing.length} photo${missing.length === 1 ? "" : "s"} still need manual review.` : null
  await admin.from("room_analysis_runs").update({
    status: partial ? "partial" : "complete",
    analyzed_photo_count: parsed.proposals.length,
    cost_cents: costCents,
    error,
    completed_at: new Date().toISOString(),
  }).eq("id", run.id)
  return NextResponse.json({ runId: run.id, status: partial ? "partial" : "complete", proposalCount: parsed.proposals.length, error })
}
