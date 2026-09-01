import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { PresetDefaultScope } from "@/lib/edit-presets"

type DefaultBody = {
  presetId?: string
  scopeType?: PresetDefaultScope
  listingId?: string | null
  roomId?: string | null
}

function shape(body: DefaultBody | null) {
  if (!body || !["account", "listing", "room"].includes(body.scopeType ?? "")) {
    throw new Error("Choose an account, listing, or room default.")
  }
  const scopeType = body.scopeType!
  const listingId = scopeType === "account" ? null : body.listingId ?? null
  const roomId = scopeType === "room" ? body.roomId ?? null : null
  if ((scopeType !== "account" && !listingId) || (scopeType === "room" && !roomId)) {
    throw new Error("The default scope is incomplete.")
  }
  return { scopeType, listingId, roomId }
}

async function ownedScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  listingId: string | null,
  roomId: string | null
) {
  if (!listingId) return true
  const { data: listing } = await supabase
    .from("listings")
    .select("id")
    .eq("id", listingId)
    .eq("user_id", userId)
    .maybeSingle()
  if (!listing) return false
  if (!roomId) return true
  const { data: room } = await supabase
    .from("rooms")
    .select("id")
    .eq("id", roomId)
    .eq("listing_id", listingId)
    .maybeSingle()
  return Boolean(room)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => null)) as DefaultBody | null
  if (!body?.presetId) return NextResponse.json({ error: "Choose a preset." }, { status: 400 })
  let scope
  try {
    scope = shape(body)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid default scope." }, { status: 400 })
  }
  const [{ data: preset }, scopeOwned] = await Promise.all([
    supabase.from("edit_presets").select("id").eq("id", body.presetId).eq("user_id", user.id).maybeSingle(),
    ownedScope(supabase, user.id, scope.listingId, scope.roomId),
  ])
  if (!preset || !scopeOwned) return NextResponse.json({ error: "Preset or scope not found." }, { status: 404 })

  let existingQuery = supabase
    .from("edit_preset_defaults")
    .select("id")
    .eq("user_id", user.id)
    .eq("scope_type", scope.scopeType)
  existingQuery = scope.listingId
    ? existingQuery.eq("listing_id", scope.listingId)
    : existingQuery.is("listing_id", null)
  existingQuery = scope.roomId
    ? existingQuery.eq("room_id", scope.roomId)
    : existingQuery.is("room_id", null)
  const { data: existing } = await existingQuery.maybeSingle()
  const values = {
    user_id: user.id,
    preset_id: body.presetId,
    scope_type: scope.scopeType,
    listing_id: scope.listingId,
    room_id: scope.roomId,
  }
  const mutation = existing
    ? supabase.from("edit_preset_defaults").update(values).eq("id", existing.id)
    : supabase.from("edit_preset_defaults").insert(values)
  const { data, error } = await mutation
    .select("id, preset_id, scope_type, listing_id, room_id, created_at, updated_at")
    .single()
  if (error) return NextResponse.json({ error: "Could not set the preset default." }, { status: 500 })
  return NextResponse.json({ default: data })
}

export async function DELETE(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => null)) as DefaultBody | null
  let scope
  try {
    scope = shape(body)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid default scope." }, { status: 400 })
  }
  let query = supabase
    .from("edit_preset_defaults")
    .delete()
    .eq("user_id", user.id)
    .eq("scope_type", scope.scopeType)
  query = scope.listingId ? query.eq("listing_id", scope.listingId) : query.is("listing_id", null)
  query = scope.roomId ? query.eq("room_id", scope.roomId) : query.is("room_id", null)
  const { error } = await query
  if (error) return NextResponse.json({ error: "Could not clear the preset default." }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
