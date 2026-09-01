import { NextResponse } from "next/server"
import { validateDeliveryProfileInput } from "@/lib/delivery"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

const PROFILE_SELECT = "id, name, file_format, max_width, max_height, quality, max_bytes, disclosure_mode, naming_pattern, ordering, created_at, updated_at"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { data, error } = await supabase.from("delivery_profiles").select(PROFILE_SELECT).order("name")
  if (error) return NextResponse.json({ error: "Could not load delivery profiles." }, { status: 500 })
  return NextResponse.json({ profiles: data ?? [] })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  let profile
  try {
    profile = validateDeliveryProfileInput(await req.json())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Profile details are invalid." }, { status: 400 })
  }
  const { data, error } = await createAdminClient().from("delivery_profiles").insert({
    user_id: user.id,
    name: profile.name,
    file_format: profile.fileFormat,
    max_width: profile.maxWidth,
    max_height: profile.maxHeight,
    quality: profile.quality,
    max_bytes: profile.maxBytes,
    disclosure_mode: profile.disclosureMode,
    naming_pattern: profile.namingPattern,
    ordering: profile.ordering,
  }).select(PROFILE_SELECT).single()
  if (error) {
    const duplicate = error.code === "23505"
    return NextResponse.json({ error: duplicate ? "A delivery profile with that name already exists." : "Could not save the delivery profile." }, { status: duplicate ? 409 : 500 })
  }
  return NextResponse.json({ profile: data }, { status: 201 })
}
