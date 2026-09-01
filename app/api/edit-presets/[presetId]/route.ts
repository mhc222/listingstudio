import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { validatePresetName } from "@/lib/edit-presets"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ presetId: string }> }
) {
  const { presetId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null
  let name
  try {
    name = validatePresetName(body?.name)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Preset name is invalid." },
      { status: 400 }
    )
  }
  const { data: owned } = await supabase
    .from("edit_presets")
    .select("id")
    .eq("id", presetId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!owned) return NextResponse.json({ error: "preset not found" }, { status: 404 })
  const { data, error } = await createAdminClient()
    .from("edit_presets")
    .update({ name })
    .eq("id", presetId)
    .eq("user_id", user.id)
    .select("id, name, edit_chain, size_preset, settings_summary, created_at, updated_at")
    .maybeSingle()
  if (error) {
    const duplicate = error.code === "23505"
    return NextResponse.json(
      { error: duplicate ? "A preset with that name already exists." : "Could not rename the preset." },
      { status: duplicate ? 409 : 500 }
    )
  }
  if (!data) return NextResponse.json({ error: "preset changed; refresh and try again" }, { status: 409 })
  return NextResponse.json({ preset: data })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ presetId: string }> }
) {
  const { presetId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { data: owned } = await supabase
    .from("edit_presets")
    .select("id")
    .eq("id", presetId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!owned) return NextResponse.json({ error: "preset not found" }, { status: 404 })
  const { data, error } = await createAdminClient()
    .from("edit_presets")
    .delete()
    .eq("id", presetId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle()
  if (error) return NextResponse.json({ error: "Could not delete the preset." }, { status: 500 })
  if (!data) return NextResponse.json({ error: "preset changed; refresh and try again" }, { status: 409 })
  return NextResponse.json({ deleted: true })
}
