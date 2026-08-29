import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import heicConvert from "heic-convert"
import { createClient } from "@/lib/supabase/server"
import { upload } from "@/lib/storage"
import { fuseExposures } from "@/lib/hdr"

export const maxDuration = 120

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]

function isHeic(file: File) {
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.heic$|\.heif$/i.test(file.name)
  )
}

// HDR_MERGE (phase 14): 3-9 brackets in, one fused photo out — pure code, no
// AI call, no ledger row. The merged result lands in photos like any upload;
// the optional IMAGE_ENHANCEMENT chain is a normal /api/jobs call from the
// client with the returned photoId.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const form = await req.formData()
  const listingId = form.get("listingId") as string
  const roomId = (form.get("roomId") as string) || null
  const files = form.getAll("files") as File[]
  if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 })
  if (files.length < 3 || files.length > 9) {
    return NextResponse.json({ error: "HDR merge needs 3-9 bracketed exposures" }, { status: 400 })
  }

  // RLS-scoped read proves listing ownership before the admin-free upload path
  const { data: listing } = await supabase
    .from("listings")
    .select("id")
    .eq("id", listingId)
    .single()
  if (!listing) return NextResponse.json({ error: "listing not found" }, { status: 404 })

  try {
    const buffers: Buffer[] = []
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type) && !isHeic(file)) {
        return NextResponse.json(
          { error: `${file.name}: unsupported type ${file.type || "unknown"}` },
          { status: 400 }
        )
      }
      let buf = Buffer.from(await file.arrayBuffer())
      if (isHeic(file)) {
        buf = Buffer.from(await heicConvert({ buffer: buf, format: "JPEG", quality: 0.9 }))
      }
      buffers.push(buf)
    }

    const fused = await fuseExposures(buffers)
    const meta = await sharp(fused).metadata()

    const id = crypto.randomUUID()
    const path = `${user.id}/${listingId}/${id}.jpg`
    await upload("originals", path, fused, "image/jpeg")

    const { error } = await supabase.from("photos").insert({
      id,
      listing_id: listingId,
      room_id: roomId,
      storage_path: path,
      width: meta.width ?? null,
      height: meta.height ?? null,
      is_floor_plan: false,
    })
    if (error) throw error

    return NextResponse.json({ photoId: id })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "HDR merge failed" },
      { status: 500 }
    )
  }
}
