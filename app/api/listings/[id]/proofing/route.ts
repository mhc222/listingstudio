import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

type ReviewBody = {
  requestId?: unknown
  sourcePhotoId?: unknown
  action?: unknown
  outputVersionId?: unknown
  note?: unknown
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data: listing } = await supabase.from("listings").select("id").eq("id", id).single()
  if (!listing) return NextResponse.json({ error: "not found" }, { status: 404 })

  const body = (await request.json().catch(() => null)) as ReviewBody | null
  const requestId = typeof body?.requestId === "string" ? body.requestId : ""
  const sourcePhotoId = typeof body?.sourcePhotoId === "string" ? body.sourcePhotoId : ""
  const action = body?.action === "approve" || body?.action === "needs_changes" ? body.action : null
  const outputVersionId = body?.outputVersionId === null
    ? null
    : typeof body?.outputVersionId === "string"
      ? body.outputVersionId
      : null
  const note = typeof body?.note === "string" ? body.note.trim() : null

  if (!UUID.test(requestId) || !UUID.test(sourcePhotoId) || !action) {
    return NextResponse.json({ error: "invalid review request" }, { status: 400 })
  }
  if (body?.outputVersionId !== null && !UUID.test(outputVersionId ?? "")) {
    return NextResponse.json({ error: "invalid output version" }, { status: 400 })
  }
  if (action === "needs_changes" && !outputVersionId) {
    return NextResponse.json({ error: "Choose an edited version before marking needs changes." }, { status: 400 })
  }
  if (note && note.length > 2000) {
    return NextResponse.json({ error: "Keep the review note under 2,000 characters." }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc("set_photo_review", {
    p_request_id: requestId,
    p_listing_id: id,
    p_user_id: user.id,
    p_source_photo_id: sourcePhotoId,
    p_action: action,
    p_output_version_id: outputVersionId,
    p_note: note || null,
  })
  if (error) {
    const message = error.message.includes("logical source")
      ? "This photo is no longer part of the current proofing set. Refresh and review the current representative."
      : error.message.includes("does not belong")
        ? "That version does not belong to this photo. Refresh and choose again."
        : error.message.includes("request id")
          ? "This review retry no longer matches its original decision. Try the action again."
          : "The review decision could not be saved. Try again."
    return NextResponse.json({ error: message }, { status: 409 })
  }

  return NextResponse.json({ final: data?.[0] ?? null })
}

