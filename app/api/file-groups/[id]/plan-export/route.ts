import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { download } from "@/lib/storage"
import { composePlanPng, planPdf, planSvg } from "@/lib/plan"
import type { FloorPlanRedrawOptions } from "@/lib/prompts"

export const maxDuration = 60

// Floor plan export (phase 11):
//   ?format=png|svg|pdf   (default png)
//   ?version=<output_version id>  (default latest)
// Address label + disclaimer come from the redraw step's options; the address
// itself from the listing record.
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
      "edit_chain, output_versions (id, version_number, storage_path), jobs (listings (address))"
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

  const search = new URL(req.url).searchParams
  const versionsDesc = [...fg.output_versions].sort((a, b) => b.version_number - a.version_number)
  const requestedVersion = search.get("version")
  const version = requestedVersion
    ? versionsDesc.find((v) => v.id === requestedVersion)
    : versionsDesc[0]
  if (!version) return NextResponse.json({ error: "no output yet" }, { status: 404 })

  // supabase-js types to-one joins as arrays without generated DB types
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v)
  const listing = one((one(fg.jobs) as { listings?: unknown } | null)?.listings) as
    | { address: string }
    | null
    | undefined

  const blob = await download("outputs", version.storage_path)
  const plan = await composePlanPng(Buffer.from(await blob.arrayBuffer()), {
    address: opts.address_label ? listing?.address : undefined,
    disclaimer: opts.disclaimer,
  })

  const style = opts.style ?? "2d_colour"
  const name = `floor-plan-${style}-v${version.version_number}`
  const format = search.get("format") ?? "png"
  if (format === "svg") {
    return new NextResponse(planSvg(plan), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": `attachment; filename="${name}.svg"`,
      },
    })
  }
  if (format === "pdf") {
    return new NextResponse(Buffer.from(await planPdf(plan)), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}.pdf"`,
      },
    })
  }
  return new NextResponse(new Uint8Array(plan.png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${name}.png"`,
    },
  })
}
