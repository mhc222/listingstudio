import { NextResponse } from "next/server"
import JSZip from "jszip"
import { createClient } from "@/lib/supabase/server"
import { download } from "@/lib/storage"
import { applyVariant, applyWatermark, isStaged, presetToVariant } from "@/lib/deliver"

export const maxDuration = 120

// Per-listing "download all finals" zip (phase 10): the latest version of
// every complete file group across the listing's jobs, with each group's size
// preset applied and the staging watermark at its default (ON for
// staging/renovation — CLAUDE.md compliance).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // RLS-scoped read proves ownership
  const { data: listing } = await supabase
    .from("listings")
    .select("id, address")
    .eq("id", id)
    .single()
  if (!listing) return NextResponse.json({ error: "not found" }, { status: 404 })

  const { data: jobs } = await supabase
    .from("jobs")
    .select(
      "file_groups (id, step_status, edit_chain, size_preset, output_versions (version_number, storage_path))"
    )
    .eq("listing_id", id)

  const zip = new JSZip()
  let count = 0
  for (const job of jobs ?? []) {
    for (const fg of job.file_groups) {
      if (fg.step_status !== "complete") continue
      const latest = [...fg.output_versions].sort((a, b) => b.version_number - a.version_number)[0]
      if (!latest) continue
      const blob = await download("outputs", latest.storage_path)
      let buf: Buffer = Buffer.from(await blob.arrayBuffer())
      const watermark = isStaged(fg.edit_chain as { edit_type: string }[])
      if (watermark) buf = await applyWatermark(buf)
      buf = await applyVariant(buf, presetToVariant(fg.size_preset))
      const suffix = watermark ? "-virtually-staged" : ""
      zip.file(`${fg.id.slice(0, 8)}-v${latest.version_number}${suffix}.jpg`, buf)
      count++
    }
  }
  if (count === 0) return NextResponse.json({ error: "no finished outputs yet" }, { status: 404 })

  const out = await zip.generateAsync({ type: "nodebuffer" })
  const name = listing.address.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()
  return new NextResponse(new Uint8Array(out), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name || "listing"}-finals.zip"`,
    },
  })
}
