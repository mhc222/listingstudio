import { NextResponse } from "next/server"
import { validateDeliveryProfileInput } from "@/lib/delivery"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

const PROFILE_SELECT = "id, name, file_format, max_width, max_height, quality, max_bytes, disclosure_mode, naming_pattern, ordering, created_at, updated_at"

async function ownedProfile(profileId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 401 as const, user: null }
  const { data } = await supabase.from("delivery_profiles").select("id").eq("id", profileId).maybeSingle()
  return data ? { status: 200 as const, user } : { status: 404 as const, user }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params
  const owned = await ownedProfile(profileId)
  if (!owned.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (owned.status === 404) return NextResponse.json({ error: "profile not found" }, { status: 404 })
  let profile
  try {
    profile = validateDeliveryProfileInput(await req.json())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Profile details are invalid." }, { status: 400 })
  }
  const { data, error } = await createAdminClient().from("delivery_profiles").update({
    name: profile.name,
    file_format: profile.fileFormat,
    max_width: profile.maxWidth,
    max_height: profile.maxHeight,
    quality: profile.quality,
    max_bytes: profile.maxBytes,
    disclosure_mode: profile.disclosureMode,
    naming_pattern: profile.namingPattern,
    ordering: profile.ordering,
  }).eq("id", profileId).eq("user_id", owned.user.id).select(PROFILE_SELECT).maybeSingle()
  if (error) {
    const duplicate = error.code === "23505"
    return NextResponse.json({ error: duplicate ? "A delivery profile with that name already exists." : "Could not update the delivery profile." }, { status: duplicate ? 409 : 500 })
  }
  if (!data) return NextResponse.json({ error: "profile changed; refresh and try again" }, { status: 409 })
  return NextResponse.json({ profile: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params
  const owned = await ownedProfile(profileId)
  if (!owned.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (owned.status === 404) return NextResponse.json({ error: "profile not found" }, { status: 404 })
  const { data, error } = await createAdminClient().from("delivery_profiles").delete()
    .eq("id", profileId).eq("user_id", owned.user.id).select("id").maybeSingle()
  if (error) return NextResponse.json({ error: "Could not delete the delivery profile." }, { status: 500 })
  if (!data) return NextResponse.json({ error: "profile changed; refresh and try again" }, { status: 409 })
  return NextResponse.json({ deleted: true })
}
