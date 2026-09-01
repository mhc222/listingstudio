"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export type OrganizationState = "suggested" | "confirmed" | "needs_review" | "untagged"
export type OrganizationFilter = "all" | OrganizationState

export type RoomProposalRow = {
  id: string
  run_id: string
  photo_id: string
  proposed_room_type: string
  proposed_room_name: string
  proposed_room_id: string | null
  proposed_same_room_key: string | null
  confidence: number
  evidence: string
  review_state: OrganizationState
  decision: "pending" | "accepted" | "deferred"
  accepted_room_id: string | null
}

export type SameRoomGroupRow = {
  id: string
  room_id: string
  name: string
  memberPhotoIds: string[]
}

export type RoomAnalysisRunRow = {
  id: string
  status: "pending" | "running" | "complete" | "partial" | "failed"
  analyzed_photo_count: number
  cost_cents: number
  error: string | null
  created_at: string
}

const FILTERS: Array<{ value: OrganizationFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "suggested", label: "Suggested" },
  { value: "confirmed", label: "Confirmed" },
  { value: "needs_review", label: "Needs review" },
  { value: "untagged", label: "Untagged" },
]

export function RoomOrganization({
  listingId,
  latestRun,
  proposals,
  counts,
  filter,
  onFilterChange,
  selectedPhotoIds,
}: {
  listingId: string
  latestRun: RoomAnalysisRunRow | null
  proposals: RoomProposalRow[]
  counts: Record<OrganizationState, number>
  filter: OrganizationFilter
  onFilterChange: (filter: OrganizationFilter) => void
  selectedPhotoIds: string[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const highConfidence = proposals.filter((proposal) => proposal.review_state === "suggested" && proposal.decision === "pending")

  async function request(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.error ?? "That organization change could not be saved.")
    router.refresh()
  }

  async function analyze() {
    setBusy("analyze")
    setError(null)
    try {
      await request(`/api/listings/${listingId}/room-analysis`, { requestKey: crypto.randomUUID() })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Room analysis could not finish.")
    } finally {
      setBusy(null)
    }
  }

  async function acceptHighConfidence() {
    setBusy("accept")
    setError(null)
    try {
      await request(`/api/listings/${listingId}/room-analysis/decisions`, {
        decisions: highConfidence.map((proposal) => ({
          proposal_id: proposal.id,
          action: "accept",
          room_id: proposal.proposed_room_id,
          room_name: proposal.proposed_room_name,
          room_type: proposal.proposed_room_type,
          same_room_key: proposal.proposed_same_room_key,
        })),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Suggestions could not be accepted.")
    } finally {
      setBusy(null)
    }
  }

  async function linkSelected() {
    setBusy("link")
    setError(null)
    try {
      await request(`/api/listings/${listingId}/same-room-groups`, { photoIds: selectedPhotoIds })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Those views could not be linked.")
    } finally {
      setBusy(null)
    }
  }

  const analyzing = latestRun?.status === "pending" || latestRun?.status === "running"
  return (
    <section id="room-organization" aria-labelledby="room-organization-title" className="ls-surface min-w-0 scroll-mt-24 p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <p className="ls-section-label text-muted-foreground">Organize the shoot</p>
          <h2 id="room-organization-title" className="mt-1.5 text-xl font-semibold tracking-[-0.025em]">Room review</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Get room and same-view suggestions, then confirm them before they change the listing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {highConfidence.length > 0 && (
            <Button size="sm" variant="outline" onClick={acceptHighConfidence} disabled={busy !== null}>
              {busy === "accept" ? "Accepting…" : `Accept ${highConfidence.length} clear suggestion${highConfidence.length === 1 ? "" : "s"}`}
            </Button>
          )}
          {selectedPhotoIds.length >= 2 && (
            <Button size="sm" variant="outline" onClick={linkSelected} disabled={busy !== null}>
              {busy === "link" ? "Linking…" : `Link ${selectedPhotoIds.length} as same room`}
            </Button>
          )}
          <Button size="sm" onClick={analyze} disabled={busy !== null || analyzing}>
            {busy === "analyze" || analyzing ? "Analyzing rooms…" : latestRun ? "Run room review again" : "Suggest rooms"}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex max-w-full gap-1 overflow-x-auto pb-1" aria-label="Room review filters">
        {FILTERS.map((item) => {
          const count = item.value === "all" ? Object.values(counts).reduce((sum, value) => sum + value, 0) : counts[item.value]
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => onFilterChange(item.value)}
              className={`min-h-10 shrink-0 rounded-md px-3 text-sm font-medium transition-colors ${filter === item.value ? "bg-foreground text-background" : "bg-muted/55 text-muted-foreground hover:text-foreground"}`}
            >
              {item.label} <span className="ml-1 tabular-nums opacity-75">{count}</span>
            </button>
          )
        })}
      </div>

      {latestRun?.status === "partial" && <p className="mt-3 text-sm text-amber-800">The last review was partial. {latestRun.error ?? "Some photos still need manual review."}</p>}
      {latestRun?.status === "failed" && <p className="mt-3 text-sm text-destructive">The last review failed. Your existing room tags were not changed.</p>}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <p className="mt-3 text-xs text-muted-foreground">Suggestions never apply edits or add room dimensions. Select two or more confirmed photos with the corner ＋ to link them as views of one room.</p>
    </section>
  )
}
