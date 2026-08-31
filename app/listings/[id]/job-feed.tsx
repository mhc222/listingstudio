"use client"

import { useEffect, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { StatePill } from "@/components/brand"
import { EDIT_TYPES } from "./edit-types"
import type { PhotoRow } from "./photo-grid"

export type SampleRow = {
  id: string
  label: string | null
  use_count: number
  url: string | null
}

// MLS compliance checklist stored on an output version (phase 21, migration
// 0008); null pre-migration and on non-compliance chains.
export type ComplianceNote = {
  checked_at?: string
  checks?: { id: string; label: string; pass: boolean; note?: string }[]
} | null

export type JobRow = {
  id: string
  title: string
  status: string
  kind: string
  total_cost_cents: number
  grounding_used: { dimension_sentence?: string; floor_plan_photo_id?: string } | null
  file_groups: {
    id: string
    primary_photo_id: string
    current_step: number
    step_status: string
    last_error: string | null
    comment: string | null
    edit_chain: { edit_type: string; options?: Record<string, unknown> }[]
    output_versions: {
      id: string
      version_number: number
      parent_version_id: string | null
      qa_note: string | null
      compliance: ComplianceNote
      url: string | null
    }[]
    chat_messages: { role: string; content: string; created_at: string }[]
  }[]
}

// The job feed: compact cards linking to each FileGroup workspace (phase 28),
// plus the listing-wide realtime subscription that refreshes on any job change.
export function JobFeed({
  listingId,
  photos,
  floorPlans = [],
  jobs,
}: {
  listingId: string
  photos: PhotoRow[]
  // plan redraw jobs (phase 11) have a floor plan as their primary photo —
  // included here only for before-image lookup
  floorPlans?: PhotoRow[]
  jobs: JobRow[]
}) {
  const router = useRouter()

  const photoById = useMemo(
    () => new Map([...photos, ...floorPlans].map((p) => [p.id, p])),
    [photos, floorPlans]
  )

  // live status: refetch server data whenever job state changes
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`jobs-${listingId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "file_groups" }, () =>
        router.refresh()
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () =>
        router.refresh()
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "output_versions" }, () =>
        router.refresh()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [listingId, router])

  const hasFinals = jobs.some((j) =>
    j.file_groups.some((fg) => fg.step_status === "complete" && fg.output_versions.length > 0)
  )

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium">Jobs</h2>
        {hasFinals && (
          <a
            href={`/api/listings/${listingId}/download-all`}
            className="text-sm underline hover:text-foreground"
          >
            Download all finals (zip)
          </a>
        )}
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No jobs yet — describe an edit above.</p>
      ) : (
        <div className="grid gap-3">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{job.title}</p>
                <StatePill status={job.status} />
              </div>
              {(() => {
                // job cards show the latest user message as description (CLAUDE.md)
                const lastUser = job.file_groups
                  .flatMap((fg) => fg.chat_messages ?? [])
                  .filter((m) => m.role === "user")
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .at(-1)
                return lastUser ? (
                  <p className="mt-1 text-sm text-muted-foreground">“{lastUser.content}”</p>
                ) : null
              })()}
              {job.grounding_used && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Grounding:{" "}
                  {[
                    job.grounding_used.dimension_sentence,
                    job.grounding_used.floor_plan_photo_id && "floor plan attached as reference",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {job.kind === "ideas" ? (
                // labeled 2x2 grid; each cell opens its own FileGroup page
                // (phase 28 — the promoted-in-place state is gone)
                <div className="stagger mt-3 grid grid-cols-2 gap-2">
                  {job.file_groups.map((fg) => {
                    const v = [...fg.output_versions].sort(
                      (a, b) => b.version_number - a.version_number
                    )[0]
                    return (
                      <Link
                        key={fg.id}
                        href={`/listings/${listingId}/f/${fg.id}`}
                        className="develop-in overflow-hidden rounded-md border-2 border-transparent text-left transition-colors hover:border-primary/50"
                      >
                        {v?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                          <img src={v.url} alt="" className="aspect-video w-full object-cover" />
                        ) : (
                          <div
                            className={`flex aspect-video w-full items-center justify-center bg-muted text-xs text-muted-foreground ${
                              fg.step_status === "failed" ? "" : "sweep"
                            }`}
                          >
                            {fg.step_status === "failed" ? "failed" : "generating…"}
                          </div>
                        )}
                        <p className="px-1.5 py-1 text-xs font-medium">{fg.comment}</p>
                      </Link>
                    )
                  })}
                </div>
              ) : (
                // compact card rows — each links to the FileGroup workspace where
                // before/after, versions, rework, download etc. now live (phase 28)
                job.file_groups.map((fg) => {
                  const latest = [...fg.output_versions].sort(
                    (a, b) => b.version_number - a.version_number
                  )[0]
                  const before = photoById.get(fg.primary_photo_id)
                  const thumb = latest?.url ?? before?.url ?? null
                  const summary = fg.edit_chain
                    .map((s) => EDIT_TYPES[s.edit_type]?.label ?? s.edit_type)
                    .join(" → ")
                  const doneSteps = fg.current_step + (fg.step_status === "complete" ? 1 : 0)
                  const stripeColor =
                    fg.step_status === "failed"
                      ? "bg-state-failed"
                      : fg.step_status === "complete"
                        ? "bg-state-complete"
                        : "bg-state-running"
                  return (
                    <Link
                      key={fg.id}
                      href={`/listings/${listingId}/f/${fg.id}`}
                      className="mt-3 flex items-center gap-3 rounded-md border p-2 transition-colors hover:bg-muted"
                    >
                      <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                          <img src={thumb} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div
                            className={`flex h-full w-full items-center justify-center text-[10px] text-muted-foreground ${
                              fg.step_status === "failed" ? "" : "sweep"
                            }`}
                          >
                            {fg.step_status === "failed" ? "failed" : "…"}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">{summary}</p>
                          <StatePill status={fg.step_status} />
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${stripeColor}`}
                            style={{
                              width: `${Math.round((doneSteps / Math.max(fg.edit_chain.length, 1)) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </Link>
                  )
                })
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
