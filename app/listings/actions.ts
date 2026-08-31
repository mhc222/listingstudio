"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

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
  const { error } = await supabase.from("rooms").delete().eq("id", formData.get("roomId") as string)
  if (error) throw error
  revalidatePath(`/listings/${listingId}`)
}

export async function tagPhoto(photoId: string, roomId: string | null, listingId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("photos").update({ room_id: roomId }).eq("id", photoId)
  if (error) throw error
  revalidatePath(`/listings/${listingId}`)
}
