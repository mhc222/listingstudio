import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: listingId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { photoIds?: unknown } | null
  const photoIds = Array.isArray(body?.photoIds) ? [...new Set(body.photoIds.filter((id): id is string => typeof id === "string"))] : []
  if (photoIds.length < 3 || photoIds.length > 9) return NextResponse.json({ error: "Choose 3–9 source exposures." }, { status: 400 })
  const { data: photos } = await supabase.from("photos").select("id").in("id", photoIds)
    .eq("listing_id", listingId).eq("is_floor_plan", false).eq("photo_role", "source")
  if (photos?.length !== photoIds.length) return NextResponse.json({ error: "One or more source photos are invalid." }, { status: 400 })
  const { data: existing } = await supabase.from("photo_group_members").select("photo_id").in("photo_id", photoIds)
  if (existing?.length) return NextResponse.json({ error: "Remove the photo from its current stack first." }, { status: 409 })
  const { data: group, error } = await supabase.from("photo_groups").insert({
    listing_id: listingId, confidence: 1, reason: "Created manually from the selected source exposures.",
  }).select("id").single()
  if (error || !group) return NextResponse.json({ error: error?.message ?? "Could not create stack." }, { status: 500 })
  const { error: memberError } = await supabase.from("photo_group_members").insert(
    photoIds.map((photoId, index) => ({ group_id: group.id, photo_id: photoId, position: index + 1 }))
  )
  if (memberError) {
    await supabase.from("photo_groups").delete().eq("id", group.id)
    return NextResponse.json({ error: memberError.message }, { status: 409 })
  }
  return NextResponse.json({ groupId: group.id }, { status: 201 })
}
