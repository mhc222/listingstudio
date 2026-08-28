import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { pickProvider, MODELS } from "@/config/models"
import { submitStep } from "@/lib/orchestrator"
import type { EditStep } from "@/lib/prompts"

// Create a job (one file group, or 4 for an ideas grid) and submit each first
// step. Never awaits generation — fal queue + webhook/reconcile advance the
// state machine.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json()
  const { listingId, photoId, editChain, comment, sizePreset, sampleImageIds, chat, kind, variants } =
    body as {
      listingId: string
      photoId: string
      editChain?: EditStep[]
      comment?: string
      sizePreset?: string
      sampleImageIds?: string[]
      // interpreter-path conversation, persisted per FileGroup (phase 7)
      chat?: { role: string; content: string }[]
      // ideas grid (phase 9): 4 labeled variants, each its own chain
      kind?: string
      variants?: { label: string; editChain: EditStep[] }[]
    }

  const isIdeas = kind === "ideas"
  // each grid cell is (label, chain); a normal job is a single unlabeled cell
  const cells: { label: string | null; chain: EditStep[] }[] = isIdeas
    ? (variants ?? []).map((v) => ({ label: v.label, chain: v.editChain }))
    : [{ label: null, chain: editChain ?? [] }]
  if (!listingId || !photoId || cells.length === 0 || cells.some((c) => !c.chain?.length)) {
    return NextResponse.json({ error: "listingId, photoId, editChain required" }, { status: 400 })
  }
  if (isIdeas && cells.length !== 4) {
    return NextResponse.json({ error: "ideas jobs need exactly 4 variants" }, { status: 400 })
  }

  // RLS-scoped read proves ownership of the photo/listing
  const { data: photo } = await supabase
    .from("photos")
    .select("id, listing_id, room_id")
    .eq("id", photoId)
    .eq("listing_id", listingId)
    .single()
  if (!photo) return NextResponse.json({ error: "photo not found" }, { status: 404 })

  // RLS-scoped read proves ownership of any sample refs
  let sampleIds: string[] = []
  if (sampleImageIds?.length) {
    const { data: samples } = await supabase
      .from("sample_images")
      .select("id")
      .in("id", sampleImageIds)
    sampleIds = (samples ?? []).map((s) => s.id)
  }

  const allSteps = cells.flatMap((c) => c.chain)

  // Context grounding (CLAUDE.md): room dimensions -> sentence for
  // staging/renovation/item-removal; floor plan -> extra ref on staging.
  const groundable = allSteps.some((s) =>
    ["VIRTUAL_STAGING", "ITEM_REMOVAL", "VIRTUAL_RENOVATION"].includes(s.edit_type)
  )
  const grounding: { dimension_sentence?: string; floor_plan_photo_id?: string } = {}
  if (groundable && photo.room_id) {
    const { data: room } = await supabase
      .from("rooms")
      .select("length, width, ceiling_height, units")
      .eq("id", photo.room_id)
      .single()
    if (room?.length && room?.width) {
      const unitWord = room.units === "m" ? "meters" : "feet"
      const unitAdj = room.units === "m" ? "meter" : "foot"
      grounding.dimension_sentence =
        `The room measures ${room.length} x ${room.width} ${unitWord}` +
        (room.ceiling_height ? ` with ${room.ceiling_height}-${unitAdj} ceilings` : "") +
        "; scale all furniture and objects to these dimensions."
    }
  }
  if (allSteps.some((s) => ["VIRTUAL_STAGING", "VIRTUAL_RENOVATION"].includes(s.edit_type))) {
    const { data: plans } = await supabase
      .from("photos")
      .select("id, storage_path")
      .eq("listing_id", listingId)
      .eq("is_floor_plan", true)
      .order("created_at")
      .limit(5)
    // PDFs can't be image refs
    const plan = (plans ?? []).find((p) => !p.storage_path.endsWith(".pdf"))
    if (plan) grounding.floor_plan_photo_id = plan.id
  }

  const title = isIdeas
    ? `Ideas: ${cells.map((c) => c.label).join(" / ")}`
    : cells[0].chain
        .map((s) => s.edit_type.replaceAll("_", " ").toLowerCase())
        .join(" → ") + (comment ? ` — ${comment.slice(0, 60)}` : "")

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      listing_id: listingId,
      title,
      status: "processing",
      kind: isIdeas ? "ideas" : "normal",
      grounding_used: Object.keys(grounding).length ? grounding : null,
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (jobError || !job) {
    return NextResponse.json({ error: jobError?.message ?? "job insert failed" }, { status: 500 })
  }

  const hasRefs = sampleIds.length > 0 || Boolean(grounding.floor_plan_photo_id)
  const fgIds: string[] = []
  let ideasCost = 0
  for (const cell of cells) {
    const provider = pickProvider(cell.chain.length, hasRefs)
    ideasCost += MODELS[provider].costCents * cell.chain.length
    const { data: fg, error: fgError } = await supabase
      .from("file_groups")
      .insert({
        job_id: job.id,
        primary_photo_id: photoId,
        edit_chain: cell.chain,
        // ideas labels double as style language in the prompt
        comment: cell.label ?? comment ?? null,
        size_preset: ["original", "under_10mb", "under_5mb"].includes(sizePreset ?? "")
          ? sizePreset
          : "original",
        provider,
      })
      .select("id")
      .single()
    if (fgError || !fg) {
      return NextResponse.json(
        { error: fgError?.message ?? "file group insert failed" },
        { status: 500 }
      )
    }
    fgIds.push(fg.id)

    const refRows = [
      ...sampleIds.map((id) => ({ file_group_id: fg.id, sample_image_id: id })),
      ...(grounding.floor_plan_photo_id
        ? [{ file_group_id: fg.id, photo_id: grounding.floor_plan_photo_id }]
        : []),
    ]
    if (refRows.length) {
      const { error: refError } = await supabase.from("file_group_refs").insert(refRows)
      if (refError) {
        return NextResponse.json({ error: refError.message }, { status: 500 })
      }
    }
  }

  const admin = createAdminClient()

  // Ideas spend: 4 image calls = ONE ideas ledger entry (CLAUDE.md), written
  // upfront; per-completion rows are skipped for ideas jobs (retries excepted).
  if (isIdeas && ideasCost > 0) {
    await admin.from("spend_ledger").insert({
      job_id: job.id,
      model: "mixed",
      cost_cents: ideasCost,
      kind: "ideas",
    })
    await admin.rpc("increment_job_cost", { p_job_id: job.id, p_cents: ideasCost })
  }

  // style memory: frequency count per sample (CLAUDE.md) — single-user, so a
  // read-then-write increment is fine
  if (sampleIds.length) {
    const { data: counts } = await supabase
      .from("sample_images")
      .select("id, use_count")
      .in("id", sampleIds)
    for (const s of counts ?? []) {
      await supabase
        .from("sample_images")
        .update({ use_count: (s.use_count ?? 0) + 1 })
        .eq("id", s.id)
    }
  }

  const chatRows = (chat ?? [])
    .filter((m) => ["user", "assistant"].includes(m.role) && m.content?.trim())
    .map((m) => ({ file_group_id: fgIds[0], role: m.role, content: m.content.trim() }))
  if (chatRows.length) {
    await supabase.from("chat_messages").insert(chatRows)
  }

  // submission runs with the admin client (also used by webhook/cron paths)
  for (const fgId of fgIds) {
    await submitStep(admin, fgId)
  }

  return NextResponse.json({ jobId: job.id, fileGroupIds: fgIds })
}
