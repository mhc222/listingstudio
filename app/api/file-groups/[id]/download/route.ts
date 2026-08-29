import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { download } from "@/lib/storage"
import {
  applyVariant,
  applyWatermark,
  isStaged,
  presetToVariant,
  VARIANTS,
  type Variant,
} from "@/lib/deliver"

const ORIGINAL_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

// Download menu (phase 10):
//   ?variant=original|full|web1920|under_10mb|under_5mb  (default: fg.size_preset;
//     "original" is the untouched source photo, "full" the full-res edited output)
//   ?version=<output_version id>                          (default: latest)
//   ?watermark=1|0  (default ON when the chain has staging/renovation — CLAUDE.md)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // RLS-scoped read proves ownership
  const { data: fg } = await supabase
    .from("file_groups")
    .select(
      "size_preset, edit_chain, photos!file_groups_primary_photo_id_fkey (storage_path), output_versions (id, version_number, storage_path)"
    )
    .eq("id", id)
    .single()
  if (!fg) return NextResponse.json({ error: "not found" }, { status: 404 })

  const search = new URL(req.url).searchParams

  // untouched source photo — no sharp, no watermark
  if (search.get("variant") === "original") {
    // supabase-js types to-one joins as arrays without generated DB types
    const photo = (Array.isArray(fg.photos) ? fg.photos[0] : fg.photos) as
      | { storage_path: string }
      | null
    if (!photo) return NextResponse.json({ error: "original not found" }, { status: 404 })
    const ext = photo.storage_path.split(".").pop()?.toLowerCase() ?? "jpg"
    const blob = await download("originals", photo.storage_path)
    return new NextResponse(new Uint8Array(await blob.arrayBuffer()), {
      headers: {
        "Content-Type": ORIGINAL_TYPES[ext] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="original.${ext}"`,
      },
    })
  }

  const versionsDesc = [...fg.output_versions].sort((a, b) => b.version_number - a.version_number)
  const requestedVersion = search.get("version")
  const version = requestedVersion
    ? versionsDesc.find((v) => v.id === requestedVersion)
    : versionsDesc[0]
  if (!version) return NextResponse.json({ error: "no output yet" }, { status: 404 })

  const requested = search.get("variant")
  const variant: Variant = (VARIANTS as readonly string[]).includes(requested ?? "")
    ? (requested as Variant)
    : presetToVariant(fg.size_preset)

  const stagedDefault = isStaged(fg.edit_chain as { edit_type: string }[])
  const wmParam = search.get("watermark")
  const watermark = wmParam === null ? stagedDefault : wmParam === "1"

  const blob = await download("outputs", version.storage_path)
  let buf: Buffer = Buffer.from(await blob.arrayBuffer())
  if (watermark) buf = await applyWatermark(buf) // before the quality ladder
  buf = await applyVariant(buf, variant)

  const suffix = watermark ? "-virtually-staged" : ""
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="output-v${version.version_number}${suffix}.jpg"`,
    },
  })
}
