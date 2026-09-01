import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { validatePresetInput } from "@/lib/edit-presets"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const [{ data: presets, error: presetError }, { data: defaults, error: defaultError }] = await Promise.all([
    supabase
      .from("edit_presets")
      .select("id, name, edit_chain, size_preset, settings_summary, created_at, updated_at")
      .order("name"),
    supabase
      .from("edit_preset_defaults")
      .select("id, preset_id, scope_type, listing_id, room_id, created_at, updated_at")
      .order("created_at"),
  ])
  if (presetError || defaultError) {
    return NextResponse.json({ error: "Could not load saved presets." }, { status: 500 })
  }
  return NextResponse.json({ presets: presets ?? [], defaults: defaults ?? [] })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let preset
  try {
    preset = validatePresetInput(await req.json())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Preset details are invalid." },
      { status: 400 }
    )
  }

  const { data, error } = await createAdminClient()
    .from("edit_presets")
    .insert({
      user_id: user.id,
      name: preset.name,
      edit_chain: preset.editChain,
      size_preset: preset.sizePreset,
      settings_summary: preset.settingsSummary,
    })
    .select("id, name, edit_chain, size_preset, settings_summary, created_at, updated_at")
    .single()
  if (error) {
    const duplicate = error.code === "23505"
    return NextResponse.json(
      { error: duplicate ? "A preset with that name already exists." : "Could not save the preset." },
      { status: duplicate ? 409 : 500 }
    )
  }
  return NextResponse.json({ preset: data }, { status: 201 })
}
