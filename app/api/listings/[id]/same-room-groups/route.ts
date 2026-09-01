import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logicalPhotoIds } from "@/lib/hdr-groups"

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: listingId } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { photoIds?: string[]; name?: string } | null
  const photoIds = [...new Set(body?.photoIds ?? [])]
  if (photoIds.length < 2 || photoIds.length > 100) {
    return NextResponse.json({ error: "Choose at least two views." }, { status: 400 })
  }
  const [{ data: photos }, { data: groups }, { data: members }, { data: existingMemberships }] = await Promise.all([
    supabase.from("photos").select("id, room_id, is_floor_plan, photo_role").eq("listing_id", listingId).in("id", photoIds),
    supabase.from("photo_groups").select("id, representative_photo_id").eq("listing_id", listingId).eq("state", "confirmed"),
    supabase.from("photo_group_members").select("group_id, photo_id, photo_groups!inner(listing_id)").eq("photo_groups.listing_id", listingId),
    supabase.from("same_room_group_members").select("photo_id, same_room_groups!inner(listing_id)").in("photo_id", photoIds).eq("same_room_groups.listing_id", listingId),
  ])
  if ((photos ?? []).length !== photoIds.length) return NextResponse.json({ error: "One or more photos were not found." }, { status: 404 })
  const membersByGroup = new Map<string, string[]>()
  for (const member of members ?? []) {
    const next = membersByGroup.get(member.group_id) ?? []
    next.push(member.photo_id)
    membersByGroup.set(member.group_id, next)
  }
  const logical = new Set(logicalPhotoIds(photos ?? [], (groups ?? []).map((group) => ({ representative_photo_id: group.representative_photo_id, members: membersByGroup.get(group.id) ?? [] }))))
  if (photoIds.some((id) => !logical.has(id))) return NextResponse.json({ error: "Only current listing photos can be linked." }, { status: 409 })
  const roomId = photos?.[0]?.room_id
  if (!roomId || photos?.some((photo) => photo.room_id !== roomId)) return NextResponse.json({ error: "Tag the selected views to the same room first." }, { status: 409 })
  if (existingMemberships?.length) return NextResponse.json({ error: "Unlink the existing same-room group before creating another." }, { status: 409 })

  const admin = createAdminClient()
  const room = await supabase.from("rooms").select("name").eq("id", roomId).eq("listing_id", listingId).single()
  const name = body?.name?.trim().slice(0, 80) || room.data?.name || "Same room"
  const { data: group, error: groupError } = await admin.from("same_room_groups").insert({ listing_id: listingId, room_id: roomId, name }).select("id").single()
  if (groupError || !group) return NextResponse.json({ error: "Could not link those views." }, { status: 500 })
  const { error: memberError } = await admin.from("same_room_group_members").insert(photoIds.map((photoId, index) => ({ group_id: group.id, photo_id: photoId, position: index + 1 })))
  if (memberError) {
    await admin.from("same_room_groups").delete().eq("id", group.id)
    return NextResponse.json({ error: "Could not link those views." }, { status: 500 })
  }
  return NextResponse.json({ groupId: group.id, count: photoIds.length })
}
