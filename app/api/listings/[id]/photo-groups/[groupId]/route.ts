import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

async function context(listingId: string, groupId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  const { data: group } = await supabase.from("photo_groups").select("id, state")
    .eq("id", groupId).eq("listing_id", listingId).maybeSingle()
  if (!group) return { response: NextResponse.json({ error: "HDR stack not found" }, { status: 404 }) }
  return { user, group }
}
export async function PUT(req: Request, { params }: { params: Promise<{ id: string; groupId: string }> }) {
  const { id: listingId, groupId } = await params
  const owned = await context(listingId, groupId)
  if ("response" in owned) return owned.response
  const body = (await req.json().catch(() => null)) as { photoIds?: unknown } | null
  const photoIds = Array.isArray(body?.photoIds) ? body.photoIds.filter((id): id is string => typeof id === "string") : []
  if (photoIds.length < 3 || photoIds.length > 9 || new Set(photoIds).size !== photoIds.length) {
    return NextResponse.json({ error: "Choose 3–9 unique source exposures." }, { status: 400 })
  }
  const { error } = await createAdminClient().rpc("replace_hdr_group_members", {
    p_group_id: groupId, p_user_id: owned.user.id, p_photo_ids: photoIds,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  return NextResponse.json({ groupId, status: "proposed" })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; groupId: string }> }) {
  const { id: listingId, groupId } = await params
  const owned = await context(listingId, groupId)
  if ("response" in owned) return owned.response
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null
  if (body?.action !== "dismiss" && body?.action !== "reopen") {
    return NextResponse.json({ error: "action must be dismiss or reopen" }, { status: 400 })
  }
  const fn = body.action === "dismiss" ? "dismiss_hdr_group" : "reopen_hdr_group"
  const { error } = await createAdminClient().rpc(fn, { p_group_id: groupId, p_user_id: owned.user.id })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  return NextResponse.json({ groupId, status: body.action === "dismiss" ? "dismissed" : "proposed" })
}
