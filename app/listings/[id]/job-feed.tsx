"use client"

import { useEffect, useMemo } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { realtimeInFilters } from "@/lib/refresh-discipline"
import { useDebouncedRefresh, useReconcilePoll } from "@/lib/use-live-refresh"
import { StatePill } from "@/components/brand"
import { Disclosure } from "@/components/ui/disclosure"
import { EDIT_TYPES } from "./edit-types"
import type { PhotoRow } from "./photo-grid"
import { deriveJobDisplayStatus } from "@/lib/listing-status"

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
  created_at?: string
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
    approved?: boolean
    chat_messages: { role: string; content: string; created_at: string }[]
  }[]
}

function humanTitle(value: string): string {
  const american = value.replace(/\bcolour\b/gi, (word) => (word[0] === "C" ? "Color" : "color"))
  return american ? american.charAt(0).toUpperCase() + american.slice(1) : "Photo edit"
}

function feetAndInches(value: string): string {
  return value.replace(/(\d+(?:\.\d+)?) x (\d+(?:\.\d+)?) ft/g, (_match, a, b) => {
    const format = (raw: string) => {
      let feet = Math.floor(Number(raw))
      let inches = Math.round((Number(raw) - feet) * 12)
      if (inches === 12) {
        feet += 1
        inches = 0
      }
      return inches ? `${feet}′${inches}″` : `${feet}′`
    }
    return `${format(a)} × ${format(b)}`
  })
}

function editSummary(chain: { edit_type: string }[]): string {
  const labels = chain
    .filter((step) => step.edit_type !== "REWORK")
    .map((step) => {
      const catalogLabel = EDIT_TYPES[step.edit_type]?.label
      if (catalogLabel) return catalogLabel
      const words = step.edit_type.toLowerCase().replaceAll("_", " ")
      return words.charAt(0).toUpperCase() + words.slice(1)
    })
  return labels.join(" → ") || "Photo revision"
}

// Editorial activity list linking to each FileGroup workspace (phase 35), plus
// the listing-wide realtime subscription that refreshes on any job change.
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
  const refresh = useDebouncedRefresh()
  const jobKey = jobs.map((job) => job.id).join(",")
  const fileGroupKey = jobs.flatMap((job) => job.file_groups.map((group) => group.id)).join(",")

  const photoById = useMemo(
    () => new Map([...photos, ...floorPlans].map((p) => [p.id, p])),
    [photos, floorPlans]
  )

  // live status: refetch server data whenever this listing's job state changes
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`jobs-${listingId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `listing_id=eq.${listingId}` }, refresh)
    for (const filter of realtimeInFilters("job_id", jobKey.split(",")))
      channel.on("postgres_changes", { event: "*", schema: "public", table: "file_groups", filter }, refresh)
    for (const filter of realtimeInFilters("file_group_id", fileGroupKey.split(",")))
      channel.on("postgres_changes", { event: "*", schema: "public", table: "output_versions", filter }, refresh)
    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [fileGroupKey, jobKey, listingId, refresh])

  const hasActive = jobs.some(
    (job) =>
      job.status === "processing" ||
      job.status === "queued" ||
      job.file_groups.some((group) => group.step_status === "running" || group.step_status === "queued")
  )

  useReconcilePoll({ listingId, active: hasActive, refresh })

  const hasReviewable = jobs.some((j) =>
    j.file_groups.some((fg) => fg.step_status === "complete" && fg.output_versions.length > 0)
  )

  return (
    <section aria-labelledby="activity-feed-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="ls-section-label text-muted-foreground">
            Listing history
          </p>
          <h2 id="activity-feed-title" className="mt-1.5 text-2xl font-semibold tracking-[-0.03em]">Recent edits</h2>
        </div>
        {hasReviewable && (
          <Link
            href={`/listings/${listingId}/proofing`}
            className="text-sm underline underline-offset-4 hover:text-foreground"
          >
            Review and choose finals
          </Link>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="ls-surface p-8">
          <p className="text-xl font-semibold tracking-[-0.025em]">No edits yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Return to Photos and open an image to begin.
          </p>
        </div>
      ) : (
        <div className="border-t border-border">
          {jobs.map((job) => {
            const completeGroups = job.file_groups.filter(
              (group) => group.step_status === "complete"
            ).length
            const displayStatus = deriveJobDisplayStatus(
              job.file_groups.map((group) => ({
                stepStatus: group.step_status,
                outputCount: group.output_versions.length,
                approved: group.approved,
              })),
              job.status
            )
            return (
            <article id={`job-${job.id}`} key={job.id} className="scroll-mt-24 border-b border-border py-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold tracking-[-0.025em]">{humanTitle(job.title)}</h3>
                  {job.created_at && (
                    <time className="mt-1 block text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: "America/New_York",
                      }).format(new Date(job.created_at))}
                    </time>
                  )}
                </div>
                <StatePill status={displayStatus.status} label={displayStatus.label} />
              </div>
              {(() => {
                // job cards show the latest user message as description (CLAUDE.md)
                const lastUser = job.file_groups
                  .flatMap((fg) => fg.chat_messages ?? [])
                  .filter((m) => m.role === "user")
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .at(-1)
                return lastUser ? (
                  <p className="mt-2 max-w-3xl text-sm text-muted-foreground">“{lastUser.content}”</p>
                ) : null
              })()}
              {job.grounding_used && (
                <Disclosure
                  className="mt-3 max-w-3xl"
                  summary="Edit context"
                  triggerClassName="min-h-8 px-0 text-xs"
                  contentClassName="px-0 pb-0"
                >
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {feetAndInches(
                      [
                        job.grounding_used.dimension_sentence,
                        job.grounding_used.floor_plan_photo_id && "Floor plan attached as reference",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    )}
                  </p>
                </Disclosure>
              )}
              {job.file_groups.length > 1 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {completeGroups} of {job.file_groups.length} photos ready
                </p>
              )}
              {job.kind === "ideas" ? (
                // labeled 2x2 grid; each cell opens its own FileGroup page
                // (phase 28 — the promoted-in-place state is gone)
                <div className="stagger mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {job.file_groups.map((fg) => {
                    const v = [...fg.output_versions].sort(
                      (a, b) => b.version_number - a.version_number
                    )[0]
                    return (
                      <Link
                        key={fg.id}
                        href={`/listings/${listingId}/f/${fg.id}`}
                        className="develop-in overflow-hidden text-left transition-opacity hover:opacity-80"
                      >
                        {v?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                          <img src={v.url} alt={fg.comment ?? "Edit direction"} className="aspect-video w-full object-cover" />
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
                <div className="mt-4 divide-y divide-border border-y border-border">
                {job.file_groups.map((fg) => {
                  const latest = [...fg.output_versions].sort(
                    (a, b) => b.version_number - a.version_number
                  )[0]
                  const before = photoById.get(fg.primary_photo_id)
                  const thumb = latest?.url ?? before?.url ?? null
                  const summary = editSummary(fg.edit_chain)
                  const doneSteps = fg.current_step + (fg.step_status === "complete" ? 1 : 0)
                  return (
                    <Link
                      key={fg.id}
                      href={`/listings/${listingId}/f/${fg.id}`}
                      className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-4 py-3 transition-opacity hover:opacity-75"
                    >
                      <div className="aspect-[4/3] overflow-hidden bg-muted">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                          <img src={thumb} alt={`${summary} result`} className="h-full w-full object-cover" />
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
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{summary}</p>
                        {fg.step_status !== "complete" && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Step {Math.min(doneSteps + 1, Math.max(fg.edit_chain.length, 1))} of {Math.max(fg.edit_chain.length, 1)}
                          </p>
                        )}
                        {fg.last_error && (
                          <p className="mt-1 text-xs text-destructive">{fg.last_error}</p>
                        )}
                      </div>
                      <span className="text-sm text-primary">Open →</span>
                    </Link>
                  )
                })}
                </div>
              )}
            </article>
          )})}
        </div>
      )}
    </section>
  )
}
