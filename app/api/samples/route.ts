import { NextRequest, NextResponse } from "next/server"
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

// Upload account-level sample library images (references bucket).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const form = await req.formData()
  const label = ((form.get("label") as string) || "").trim() || null
  const files = form.getAll("files") as File[]
  if (files.length === 0)
    return NextResponse.json({ error: "files required" }, { status: 400 })

  const uploaded: string[] = []
  const errors: string[] = []

  for (const file of files) {
    try {
      if (!IMAGE_TYPES.includes(file.type) && !isHeic(file)) {
        errors.push(`${file.name}: unsupported type ${file.type || "unknown"}`)
        continue
      }
      let buf = Buffer.from(await file.arrayBuffer())
      let contentType = file.type
      let ext = file.name.split(".").pop()?.toLowerCase() || "jpg"
      if (isHeic(file)) {
        buf = Buffer.from(await heicConvert({ buffer: buf, format: "JPEG", quality: 0.9 }))
        contentType = "image/jpeg"
        ext = "jpg"
      }

      const id = crypto.randomUUID()
      const path = `${user.id}/${id}.${ext}`
      await upload("references", path, buf, contentType)

      const { error } = await supabase.from("sample_images").insert({
        id,
        storage_path: path,
        label: label ?? file.name.replace(/\.[^.]+$/, ""),
      })
      if (error) throw error
      uploaded.push(id)
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`)
    }
  }

  return NextResponse.json(
    { uploaded, errors },
    { status: errors.length && !uploaded.length ? 500 : 200 }
  )
}
