import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import heicConvert from "heic-convert"
import { createClient } from "@/lib/supabase/server"
import { upload } from "@/lib/storage"

export const maxDuration = 120

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]

function isHeic(file: File) {
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.heic$|\.heif$/i.test(file.name)
  )
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const form = await req.formData()
  const listingId = form.get("listingId") as string
  const roomId = (form.get("roomId") as string) || null
  const isFloorPlan = form.get("isFloorPlan") === "true"
  const files = form.getAll("files") as File[]
  if (!listingId || files.length === 0)
    return NextResponse.json({ error: "listingId and files required" }, { status: 400 })

  const uploaded: string[] = []
  const errors: string[] = []

  for (const file of files) {
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name)
      if (isPdf && !isFloorPlan) {
        errors.push(`${file.name}: PDFs only accepted as floor plans`)
        continue
      }
      if (!isPdf && !IMAGE_TYPES.includes(file.type) && !isHeic(file)) {
        errors.push(`${file.name}: unsupported type ${file.type || "unknown"}`)
        continue
      }

      let buf = Buffer.from(await file.arrayBuffer())
      let contentType = file.type
      let ext = file.name.split(".").pop()?.toLowerCase() || "jpg"
      let width: number | null = null
      let height: number | null = null

      if (!isPdf) {
        if (isHeic(file)) {
          buf = Buffer.from(await heicConvert({ buffer: buf, format: "JPEG", quality: 0.9 }))
          contentType = "image/jpeg"
          ext = "jpg"
        }
        let meta = await sharp(buf).metadata()
        // Phones tag rotation in EXIF instead of rotating pixels. fal fetches the
        // stored bytes and image models do not read EXIF, so an untouched portrait
        // shot reaches the model on its side (browsers hide this — they honour the
        // tag). Bake the rotation in ONLY when the tag says it is needed, so
        // correctly-oriented originals stay byte-identical (CLAUDE.md: originals
        // preserved untouched).
        if ((meta.orientation ?? 1) > 1) {
          buf = await sharp(buf).rotate().toBuffer()
          meta = await sharp(buf).metadata()
        }
        width = meta.width ?? null
        height = meta.height ?? null
      } else {
        contentType = "application/pdf"
        ext = "pdf"
      }

      const id = crypto.randomUUID()
      const path = `${user.id}/${listingId}/${id}.${ext}`
      await upload("originals", path, buf, contentType)

      const { error } = await supabase.from("photos").insert({
        id,
        listing_id: listingId,
        room_id: roomId,
        storage_path: path,
        width,
        height,
        is_floor_plan: isFloorPlan,
      })
      if (error) throw error
      uploaded.push(id)
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`)
    }
  }

  return NextResponse.json({ uploaded, errors }, { status: errors.length && !uploaded.length ? 500 : 200 })
}
