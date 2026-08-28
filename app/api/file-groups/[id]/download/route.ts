import { NextResponse } from "next/server"
import sharp from "sharp"
import { createClient } from "@/lib/supabase/server"
import { download } from "@/lib/storage"

const CAPS_BYTES: Record<string, number> = {
  under_10mb: 10 * 1024 * 1024,
  under_5mb: 5 * 1024 * 1024,
}

// Download the latest output version, applying the group's size preset via
// sharp at download time (DECISIONS.md — presets never stored as objects).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // RLS-scoped read proves ownership
  const { data: fg } = await supabase
    .from("file_groups")
    .select("size_preset, output_versions (version_number, storage_path)")
    .eq("id", id)
    .single()
  if (!fg) return NextResponse.json({ error: "not found" }, { status: 404 })

  const latest = [...fg.output_versions].sort((a, b) => b.version_number - a.version_number)[0]
  if (!latest) return NextResponse.json({ error: "no output yet" }, { status: 404 })

  const blob = await download("outputs", latest.storage_path)
  let buf = Buffer.from(await blob.arrayBuffer())

  const cap = CAPS_BYTES[fg.size_preset]
  if (cap && buf.length > cap) {
    // ponytail: descending-quality ladder, first fit wins; enough for MLS caps
    for (const quality of [90, 80, 70, 60, 50, 40]) {
      const candidate = await sharp(buf).jpeg({ quality }).toBuffer()
      if (candidate.length <= cap) {
        buf = candidate
        break
      }
    }
  }

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="output-v${latest.version_number}.jpg"`,
    },
  })
}
