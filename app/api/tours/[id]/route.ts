import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

type SceneUpdate = {
  id?: string
  name?: unknown
  order_index?: unknown
  initial_yaw?: unknown
  hotspots?: unknown
}

function cleanHotspots(v: unknown) {
  if (!Array.isArray(v)) return []
  return v
    .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
    .map((h) => ({
      yaw: Number(h.yaw) || 0,
      pitch: Number(h.pitch) || 0,
      target: String(h.target ?? ""),
      label: String(h.label ?? "").slice(0, 80),
    }))
    .filter((h) => h.target)
}

// Update tour title / scene fields (name, order, start view, hotspots) and
// delete scenes. Pano files in the immutable originals bucket are left behind
// on delete by design (storage policy forbids deleting originals).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data: tour } = await supabase.from("tours").select("id").eq("id", id).single()
  if (!tour) return NextResponse.json({ error: "tour not found" }, { status: 404 })

  const body = await req.json().catch(() => ({}))

  if (typeof body.title === "string" && body.title.trim()) {
    const { error } = await supabase
      .from("tours")
      .update({ title: body.title.trim() })
      .eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  for (const s of (body.scenes ?? []) as SceneUpdate[]) {
    if (!s?.id) continue
    const update: Record<string, unknown> = {}
    if (typeof s.name === "string" && s.name.trim()) update.name = s.name.trim()
    if (typeof s.order_index === "number") update.order_index = s.order_index
    if (typeof s.initial_yaw === "number") update.initial_yaw = s.initial_yaw
    if (s.hotspots !== undefined) update.hotspots = cleanHotspots(s.hotspots)
    if (Object.keys(update).length === 0) continue
    const { error } = await supabase
      .from("tour_scenes")
      .update(update)
      .eq("id", s.id)
      .eq("tour_id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (Array.isArray(body.deleteSceneIds) && body.deleteSceneIds.length > 0) {
    const { error } = await supabase
      .from("tour_scenes")
      .delete()
      .in("id", body.deleteSceneIds)
      .eq("tour_id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { error } = await supabase.from("tours").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
