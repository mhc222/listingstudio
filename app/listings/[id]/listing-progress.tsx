"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import {
  LISTING_STATUS_ORDER,
  type ListingStatusKey,
  type ListingStatusSummary,
} from "@/lib/listing-status"

const LABELS: Record<ListingStatusKey, string> = {
  uploading: "Uploading",
  organizing: "Organizing",
  queued: "Queued",
  editing: "Editing",
  review_pending: "Review pending",
  needs_attention: "Needs attention",
}

export function ListingProgress({
  listingId,
  summary,
  compact = false,
}: {
  listingId: string
  summary: ListingStatusSummary
  compact?: boolean
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<ListingStatusKey | "all">(
    summary.counts.needs_attention ? "needs_attention" : "all"
  )
  const visible = useMemo(
    () => summary.items.filter((item) => filter === "all" || item.status === filter),
    [filter, summary.items]
  )
  const hasActiveGeneration = summary.counts.queued + summary.counts.editing > 0

  useEffect(() => {
    const supabase = createClient()
    const refresh = () => router.refresh()
    const channel = supabase
      .channel(`listing-progress-${listingId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "upload_batches", filter: `listing_id=eq.${listingId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "upload_items" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "photo_groups", filter: `listing_id=eq.${listingId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_analysis_runs", filter: `listing_id=eq.${listingId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_proposals", filter: `listing_id=eq.${listingId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `listing_id=eq.${listingId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "file_groups" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "output_versions" }, refresh)
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [listingId, router])

  useEffect(() => {
    if (!hasActiveGeneration) return
    let cancelled = false
    const reconcile = async () => {
      try {
        const response = await fetch(`/api/listings/${listingId}/reconcile`, { method: "POST" })
        if (response.ok && !cancelled) router.refresh()
      } catch {
        // Durable status remains visible; realtime or the next poll can recover.
      }
    }
    void reconcile()
    const timer = window.setInterval(reconcile, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [hasActiveGeneration, listingId, router])

  return (
    <section id="listing-progress" aria-labelledby="listing-progress-title" className={compact ? "" : "ls-surface p-4 sm:p-5"}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="ls-section-label text-muted-foreground">Current workflow</p>
          <h2 id="listing-progress-title" className="mt-1 text-xl font-semibold tracking-[-0.025em]">{summary.headline}</h2>
          <p className="mt-1 text-xs text-muted-foreground">Live counts come from the files, organization decisions, edits, and results below.</p>
        </div>
        {summary.total > 0 && filter !== "all" && (
          <button type="button" className="min-h-10 self-start text-xs text-primary underline underline-offset-4" onClick={() => setFilter("all")}>Show all work</button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border/65 sm:grid-cols-3 lg:grid-cols-6" aria-label="Listing workflow counts">
        {LISTING_STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={filter === status}
            onClick={() => setFilter((current) => current === status ? "all" : status)}
            className={`min-h-16 bg-card px-3 py-2 text-left transition-colors hover:bg-accent/45 ${filter === status ? "bg-accent/65" : ""}`}
          >
            <span className="block font-ui text-xl font-semibold tabular-nums">{summary.counts[status]}</span>
            <span className="block text-xs text-muted-foreground">{LABELS[status]}</span>
          </button>
        ))}
      </div>

      {visible.length > 0 ? (
        <div className="mt-4 divide-y divide-border border-y border-border" aria-live="polite">
          {visible.map((item) => (
            <div key={item.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground"><span className="font-medium text-foreground/75">{LABELS[item.status]}</span> · {item.detail}</p>
              </div>
              <Link href={item.href} className="min-h-10 shrink-0 self-start py-2 text-sm text-primary underline underline-offset-4 sm:self-auto">{item.action}</Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Nothing currently needs action. New uploads and edits will appear here.</p>
      )}
    </section>
  )
}
