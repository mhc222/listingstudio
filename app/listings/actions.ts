"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function createListing(formData: FormData) {
  const supabase = await createClient()
  const address = (formData.get("address") as string)?.trim()
  if (!address) return
  const { data, error } = await supabase
    .from("listings")
    .insert({ address, mls_number: (formData.get("mls_number") as string)?.trim() || null })
    .select("id")
    .single()
  if (error) throw error
  redirect(`/listings/${data.id}`)
}

function num(v: FormDataEntryValue | null) {
  const n = parseFloat(v as string)
  return Number.isFinite(n) ? n : null
}

export async function createRoom(formData: FormData) {
  const supabase = await createClient()
  const listingId = formData.get("listingId") as string
  const { error } = await supabase.from("rooms").insert({
    listing_id: listingId,
    name: (formData.get("name") as string)?.trim() || "Room",
    room_type: (formData.get("room_type") as string) || "other",
    length: num(formData.get("length")),
    width: num(formData.get("width")),
    ceiling_height: num(formData.get("ceiling_height")),
    units: (formData.get("units") as string) === "m" ? "m" : "ft",
    notes: (formData.get("notes") as string)?.trim() || null,
  })
  if (error) throw error
  revalidatePath(`/listings/${listingId}`)
}

// Floor-plan extraction confirms many rooms at once. Insert the reviewed set
// in one mutation and revalidate once; calling createRoom repeatedly caused
// the server tree to change while the client was still reconciling successive
// action responses, which surfaced as a RoomPanel hydration mismatch.
export async function createRooms(
  listingId: string,
  rooms: {
    name: string
    room_type: string
    length: number | null
    width: number | null
    units: string
  }[]
) {
  if (!listingId || rooms.length === 0) return
  const supabase = await createClient()
  const { error } = await supabase.from("rooms").insert(
    rooms.map((room) => ({
      listing_id: listingId,
      name: room.name?.trim() || "Room",
      room_type: room.room_type || "other",
      length: Number.isFinite(room.length) ? room.length : null,
      width: Number.isFinite(room.width) ? room.width : null,
      units: room.units === "m" ? "m" : "ft",
    }))
  )
  if (error) throw error
  revalidatePath(`/listings/${listingId}`)
}

export async function updateRoom(formData: FormData) {
  const supabase = await createClient()
  const listingId = formData.get("listingId") as string
  const { error } = await supabase
    .from("rooms")
    .update({
      name: (formData.get("name") as string)?.trim() || "Room",
      room_type: (formData.get("room_type") as string) || "other",
      length: num(formData.get("length")),
      width: num(formData.get("width")),
      ceiling_height: num(formData.get("ceiling_height")),
      units: (formData.get("units") as string) === "m" ? "m" : "ft",
      notes: (formData.get("notes") as string)?.trim() || null,
    })
    .eq("id", formData.get("roomId") as string)
  if (error) throw error
  revalidatePath(`/listings/${listingId}`)
}

export async function deleteRoom(formData: FormData) {
  const supabase = await createClient()
  const listingId = formData.get("listingId") as string
  const roomId = formData.get("roomId") as string
  const { data: room } = await supabase.from("rooms").select("id").eq("id", roomId).eq("listing_id", listingId).single()
  if (!room) return
  // Accepted proposals retain their evidence, but deleting the confirmed Room
  // returns them to the durable untagged/deferred state before the FK changes.
  await createAdminClient().from("room_proposals").update({
    decision: "deferred",
    review_state: "untagged",
    accepted_room_id: null,
    decided_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("listing_id", listingId).eq("accepted_room_id", roomId).eq("is_current", true)
  const { error } = await supabase.from("rooms").delete().eq("id", roomId)
  if (error) throw error
  revalidatePath(`/listings/${listingId}`)
}

export async function tagPhoto(photoId: string, roomId: string | null, listingId: string) {
  const supabase = await createClient()
  const { data: photo } = await supabase.from("photos").select("id, room_id").eq("id", photoId).eq("listing_id", listingId).single()
  if (!photo || photo.room_id === roomId) return
  if (roomId) {
    const { data: room } = await supabase.from("rooms").select("id").eq("id", roomId).eq("listing_id", listingId).single()
    if (!room) throw new Error("Room not found")
  }
  const { error } = await supabase.from("photos").update({ room_id: roomId }).eq("id", photoId)
  if (error) throw error
  const admin = createAdminClient()
  const { data: memberships } = await supabase.from("same_room_group_members")
    .select("group_id, same_room_groups!inner(listing_id)").eq("photo_id", photoId).eq("same_room_groups.listing_id", listingId)
  for (const membership of memberships ?? []) {
    await admin.from("same_room_group_members").delete().eq("group_id", membership.group_id).eq("photo_id", photoId)
    const { count } = await admin.from("same_room_group_members").select("photo_id", { count: "exact", head: true }).eq("group_id", membership.group_id)
    if ((count ?? 0) < 2) await admin.from("same_room_groups").delete().eq("id", membership.group_id)
  }
  if (!roomId) {
    await admin.from("room_proposals").update({
      decision: "deferred",
      review_state: "untagged",
      accepted_room_id: null,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("listing_id", listingId).eq("photo_id", photoId).eq("is_current", true)
  } else {
    await admin.from("room_proposals").update({
      decision: "accepted",
      review_state: "confirmed",
      accepted_room_id: roomId,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("listing_id", listingId).eq("photo_id", photoId).eq("is_current", true)
  }
  revalidatePath(`/listings/${listingId}`)
}
