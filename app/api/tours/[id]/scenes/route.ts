import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import { createClient } from "@/lib/supabase/server"
import { upload } from "@/lib/storage"

export const maxDuration = 120

// Panos are big flat jpgs straight off a 360 camera — no HEIC/PDF paths here.
const PANO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: tourId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data: tour } = await supabase.from("tours").select("id").eq("id", tourId).single()
  if (!tour) return NextResponse.json({ error: "tour not found" }, { status: 404 })

  const { count } = await supabase
    .from("tour_scenes")
    .select("id", { count: "exact", head: true })
    .eq("tour_id", tourId)
  let orderIndex = count ?? 0

  const form = await req.formData()
  const files = form.getAll("files") as File[]
  if (files.length === 0) return NextResponse.json({ error: "files required" }, { status: 400 })

  const uploaded: string[] = []
  const errors: string[] = []

  for (const file of files) {
    try {
      const ext = PANO_TYPES[file.type]
      if (!ext) {
        errors.push(`${file.name}: unsupported type ${file.type || "unknown"} (jpg/png/webp)`)
        continue
      }
      const buf = Buffer.from(await file.arrayBuffer())
      const meta = await sharp(buf).metadata()
      const width = meta.width ?? 0
      const height = meta.height ?? 0
      if (!width || !height) throw new Error("could not read image dimensions")
      // Equirectangular panos are 2:1 — reject obvious non-panos early.
      if (Math.abs(width / height - 2) > 0.1) {
        errors.push(`${file.name}: not a 2:1 equirectangular pano (${width}×${height})`)
        continue
      }

      const sceneId = crypto.randomUUID()
      const path = `${user.id}/tours/${tourId}/${sceneId}.${ext}`
      await upload("originals", path, buf, file.type)

      const { error } = await supabase.from("tour_scenes").insert({
        id: sceneId,
        tour_id: tourId,
        name: file.name.replace(/\.[^.]+$/, "") || "Scene",
        storage_path: path,
        width,
        order_index: orderIndex++,
      })
      if (error) throw error
      uploaded.push(sceneId)
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`)
    }
  }

  return NextResponse.json(
    { uploaded, errors },
    { status: errors.length && !uploaded.length ? 500 : 200 }
  )
}
