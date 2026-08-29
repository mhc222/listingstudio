import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { download, upload } from "@/lib/storage"
import { composePlanPng } from "@/lib/plan"
import type { FloorPlanRedrawOptions } from "@/lib/prompts"

export const maxDuration = 60

// Attach a redrawn plan back to the listing as a floor plan photo (phase 11).
// The attached plan then feeds context grounding on later staging/renovation
// jobs, and can itself be redrawn in 3D. Body: { versionId? } (default latest).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { versionId } = (await req.json().catch(() => ({}))) as { versionId?: string }

  // RLS-scoped read proves ownership
  const { data: fg } = await supabase
    .from("file_groups")
    .select(
      "edit_chain, output_versions (id, version_number, storage_path), jobs (listing_id, listings (address))"
    )
    .eq("id", id)
    .single()
  if (!fg) return NextResponse.json({ error: "not found" }, { status: 404 })

  const chain = fg.edit_chain as { edit_type: string; options?: FloorPlanRedrawOptions }[]
  const planStep = chain.find((s) => s.edit_type === "FLOOR_PLAN_REDRAW")
  if (!planStep) {
    return NextResponse.json({ error: "not a floor plan redraw" }, { status: 400 })
  }
  const opts = planStep.options ?? {}

  const versionsDesc = [...fg.output_versions].sort((a, b) => b.version_number - a.version_number)
  const version = versionId ? versionsDesc.find((v) => v.id === versionId) : versionsDesc[0]
  if (!version) return NextResponse.json({ error: "no output yet" }, { status: 404 })

  // supabase-js types to-one joins as arrays without generated DB types
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v)
  const job = one(fg.jobs) as { listing_id: string; listings?: unknown } | null
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 })
  const listing = one(job.listings) as { address: string } | null | undefined

  const blob = await download("outputs", version.storage_path)
  const plan = await composePlanPng(Buffer.from(await blob.arrayBuffer()), {
    address: opts.address_label ? listing?.address : undefined,
    disclaimer: opts.disclaimer,
  })

  const photoId = crypto.randomUUID()
  const path = `${user.id}/${job.listing_id}/${photoId}.png`
  await upload("originals", path, plan.png, "image/png")
  const { error } = await supabase.from("photos").insert({
    id: photoId,
    listing_id: job.listing_id,
    room_id: null,
    storage_path: path,
    width: plan.width,
    height: plan.height,
    is_floor_plan: true,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ photoId })
}
