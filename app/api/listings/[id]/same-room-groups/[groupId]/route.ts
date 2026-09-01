import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; groupId: string }> }) {
  const { id: listingId, groupId } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { data: group } = await supabase.from("same_room_groups").select("id").eq("id", groupId).eq("listing_id", listingId).single()
  if (!group) return NextResponse.json({ error: "same-room group not found" }, { status: 404 })
  const body = (await req.json().catch(() => null)) as { photoIds?: string[] } | null
  const photoIds = [...new Set(body?.photoIds ?? [])]
  if (photoIds.length > 100) return NextResponse.json({ error: "Too many photos." }, { status: 400 })
  const { error } = await createAdminClient().rpc("replace_same_room_group_members", {
    p_group_id: groupId,
    p_user_id: user.id,
    p_photo_ids: photoIds,
  })
  if (error) return NextResponse.json({ error: error.code === "22023" ? error.message : "Could not update same-room views." }, { status: error.code === "22023" ? 409 : 500 })
  return NextResponse.json({ groupId, count: photoIds.length >= 2 ? photoIds.length : 0 })
}
