import { NextResponse } from "next/server"
import sharp from "sharp"
import { createClient } from "@/lib/supabase/server"
import { upload } from "@/lib/storage"

export const maxDuration = 60

const MIN_DIMENSION = 400 // the min-size filter for URL-extracted refs

// Import a picked URL-extracted image into the sample library (phase 9).
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { url, label } = (await req.json()) as { url?: string; label?: string }
  try {
    new URL(url ?? "")
  } catch {
    return NextResponse.json({ error: "url required" }, { status: 400 })
  }

  let buf: Buffer
  try {
    const res = await fetch(url!, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(String(res.status))
    buf = Buffer.from(await res.arrayBuffer())
  } catch {
    return NextResponse.json({ error: "couldn't download that image" }, { status: 422 })
  }

  let jpeg: Buffer
  try {
    const img = sharp(buf)
    const meta = await img.metadata()
    if ((meta.width ?? 0) < MIN_DIMENSION || (meta.height ?? 0) < MIN_DIMENSION) {
      return NextResponse.json(
        { error: `image is too small (min ${MIN_DIMENSION}px each side)` },
        { status: 422 }
      )
    }
    jpeg = await img.jpeg({ quality: 90 }).toBuffer()
  } catch {
    return NextResponse.json({ error: "that file isn't a usable image" }, { status: 422 })
  }

  const id = crypto.randomUUID()
  const path = `${user.id}/${id}.jpg`
  await upload("references", path, jpeg, "image/jpeg")
  const { error } = await supabase.from("sample_images").insert({
    id,
    storage_path: path,
    label: (label ?? "").trim() || new URL(url!).hostname,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ id })
}
