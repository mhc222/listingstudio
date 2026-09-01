"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BeforeAfter } from "@/components/before-after"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import {
  ORIGINAL_SELECTION,
  deriveProofingQaStatus,
  deriveProofingStatus,
  initialProofingSelection,
  proofingApprovalCounts,
  proofingFinalKey,
  reconcileProofingSelection,
  sortedProofingVersions,
  type ProofingStateInput,
  type ProofingStatus,
} from "@/lib/proofing"
import type { ProofingItemRow, ProofingVersionRow } from "@/lib/proofing-server"

const STATUS_LABELS: Record<ProofingStatus, string> = {
  unreviewed: "Unreviewed",
  approved: "Approved final",
  needs_changes: "Needs changes",
  processing: "Processing",
  needs_attention: "Needs attention",
}

function stateInput(item: ProofingItemRow): ProofingStateInput {
  return {
    finalExists: Boolean(item.final),
    finalOutputVersionId: item.final?.outputVersionId ?? null,
    versions: item.versions,
    groupStatuses: item.groups.map((group) => group.status),
  }
}

function previewFor(item: ProofingItemRow) {
  const selected = initialProofingSelection(stateInput(item))
  if (selected === ORIGINAL_SELECTION) return item.originalUrl
  return item.versions.find((version) => version.id === selected)?.url ?? item.originalUrl
}

function versionLabel(version: ProofingVersionRow) {
  const revision = version.versionNumber === 1 ? "Original edit" : `Revision ${version.versionNumber - 1}`
  return `${version.jobTitle} · ${revision}`
}

export function ProofingWorkspace({
  listingId,
  items,
  initialPhotoId,
}: {
  listingId: string
  items: ProofingItemRow[]
  initialPhotoId?: string
}) {
  const router = useRouter()
  const [selectedPhotoId, setSelectedPhotoId] = useState(() =>
    items.some((item) => item.id === initialPhotoId) ? initialPhotoId! : items[0]?.id ?? ""
  )
  const [versionByPhoto, setVersionByPhoto] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.id, initialProofingSelection(stateInput(item))]))
  )
  const [roomFilter, setRoomFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [qaFilter, setQaFilter] = useState("all")
  const [reviewNote, setReviewNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const retryRef = useRef<{ key: string; id: string } | null>(null)
  const finalByPhotoRef = useRef<Record<string, string>>(
    Object.fromEntries(items.map((item) => [item.id, proofingFinalKey(stateInput(item))]))
  )

  useEffect(() => {
    setVersionByPhoto((current) => {
      const next = { ...current }
      for (const item of items) {
        const input = stateInput(item)
        const finalKey = proofingFinalKey(input)
        next[item.id] = reconcileProofingSelection(next[item.id], input, finalByPhotoRef.current[item.id] ?? "")
        // A newly approved/replaced final becomes the selected proof target.
        // Unchanged realtime/reconcile refreshes must never overwrite a
        // deliberate choice to inspect another version.
        finalByPhotoRef.current[item.id] = finalKey
      }
      return next
    })
  }, [items])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`proofing-${listingId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "photo_finals", filter: `listing_id=eq.${listingId}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "output_versions" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "file_groups" }, () => router.refresh())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [listingId, router])

  const hasActive = items.some((item) =>
    item.groups.some((group) => group.status === "queued" || group.status === "running")
  )
  useEffect(() => {
    if (!hasActive) return
    let canceled = false
    const reconcile = async () => {
      const response = await fetch(`/api/listings/${listingId}/reconcile`, { method: "POST" }).catch(() => null)
      if (!canceled && response?.ok) router.refresh()
    }
    void reconcile()
    const timer = window.setInterval(reconcile, 5000)
    return () => { canceled = true; window.clearInterval(timer) }
  }, [hasActive, listingId, router])

  const roomOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const item of items) seen.set(item.roomId ?? "untagged", item.roomName)
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [items])

  const filtered = items.filter((item) => {
    const durableSelection = initialProofingSelection(stateInput(item))
    const status = deriveProofingStatus(stateInput(item), durableSelection)
    const qa = deriveProofingQaStatus(stateInput(item), durableSelection)
    return (roomFilter === "all" || (item.roomId ?? "untagged") === roomFilter)
      && (statusFilter === "all" || status === statusFilter)
      && (qaFilter === "all" || qa === qaFilter)
  })

  useEffect(() => {
    if (filtered.length > 0 && !filtered.some((item) => item.id === selectedPhotoId)) {
      setSelectedPhotoId(filtered[0].id)
    }
  }, [filtered, selectedPhotoId])

  const selectedItem = items.find((item) => item.id === selectedPhotoId) ?? filtered[0] ?? items[0]
  const selectedVersionId = selectedItem
    ? versionByPhoto[selectedItem.id] ?? initialProofingSelection(stateInput(selectedItem))
    : ORIGINAL_SELECTION
  const selectedVersion = selectedItem?.versions.find((version) => version.id === selectedVersionId) ?? null
  const selectedStatus = selectedItem
    ? deriveProofingStatus(stateInput(selectedItem), selectedVersionId)
    : "unreviewed"
  const selectedQa = selectedItem
    ? deriveProofingQaStatus(stateInput(selectedItem), selectedVersionId)
    : "original"
  const counts = proofingApprovalCounts(items.map(stateInput))
  const activeIndex = Math.max(0, filtered.findIndex((item) => item.id === selectedItem?.id))

  function move(delta: number) {
    if (filtered.length < 2) return
    const next = (activeIndex + delta + filtered.length) % filtered.length
    setSelectedPhotoId(filtered[next].id)
    setReviewNote("")
    setError(null)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [role='combobox'], [role='listbox'], [role='option'], [contenteditable='true']")) return
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        move(-1)
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        move(1)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  async function saveReview(action: "approve" | "needs_changes") {
    if (!selectedItem || busy) return
    const outputVersionId = selectedVersionId === ORIGINAL_SELECTION ? null : selectedVersionId
    const payloadKey = JSON.stringify({ sourcePhotoId: selectedItem.id, action, outputVersionId, note: action === "needs_changes" ? reviewNote.trim() : null })
    const requestId = retryRef.current?.key === payloadKey ? retryRef.current.id : crypto.randomUUID()
    retryRef.current = { key: payloadKey, id: requestId }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/listings/${listingId}/proofing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          sourcePhotoId: selectedItem.id,
          action,
          outputVersionId,
          note: action === "needs_changes" ? reviewNote.trim() : null,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error ?? "The review decision could not be saved. Try again.")
        return
      }
      retryRef.current = null
      setReviewNote("")
      router.refresh()
      if (action === "approve" && filtered.length > 1) move(1)
    } catch {
      setError("The connection was interrupted. Your choice is still here—try again.")
    } finally {
      setBusy(false)
    }
  }

  if (items.length === 0) {
    return (
      <section className="ls-surface p-8">
        <h2 className="text-xl font-semibold tracking-[-0.025em]">No photos to proof yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">Upload photos and finish any HDR organization first.</p>
        <Button asChild className="mt-4"><Link href={`/listings/${listingId}`}>Go to photos</Link></Button>
      </section>
    )
  }

  return (
    <section aria-label="Listing proofing workspace" className="min-w-0">
      <div className="ls-surface flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        <div>
          <p className="text-2xl font-semibold tracking-[-0.03em]">{counts.approved} of {counts.total} approved</p>
          <p className="mt-1 text-xs text-muted-foreground">Only an explicit approval counts. New refinements never move a final.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="min-w-40">
            <Select aria-label="Filter by room" value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)}>
              <option value="all">All rooms</option>
              {roomOptions.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
            </Select>
          </div>
          <div className="min-w-40">
            <Select aria-label="Filter by review status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All review states</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="approved">Approved final</option>
              <option value="needs_changes">Needs changes</option>
              <option value="processing">Processing</option>
              <option value="needs_attention">Needs attention</option>
            </Select>
          </div>
          <div className="min-w-40">
            <Select aria-label="Filter by QA state" value={qaFilter} onChange={(event) => setQaFilter(event.target.value)}>
              <option value="all">All QA states</option>
              <option value="ready">Ready for MLS</option>
              <option value="review">Review recommended</option>
              <option value="original">Untouched originals</option>
            </Select>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-4 border-y border-border py-8 text-center">
          <p className="font-semibold">No photos match these filters</p>
          <button type="button" onClick={() => { setRoomFilter("all"); setStatusFilter("all"); setQaFilter("all") }} className="mt-2 text-sm underline underline-offset-4">Clear filters</button>
        </div>
      ) : (
        <div className="mt-4 grid auto-cols-[8.5rem] grid-flow-col gap-2 overflow-x-auto pb-2 sm:grid-flow-row sm:grid-cols-4 lg:grid-cols-6" aria-label="Proofing contact sheet">
          {filtered.map((item, index) => {
            const status = deriveProofingStatus(stateInput(item))
            const preview = previewFor(item)
            return (
              <button key={item.id} type="button" onClick={() => { setSelectedPhotoId(item.id); setReviewNote(""); setError(null) }}
                aria-pressed={item.id === selectedItem?.id}
                className={`ls-pressable min-w-0 overflow-hidden rounded-xl border-2 text-left ${item.id === selectedItem?.id ? "border-primary bg-card shadow-sm" : "border-transparent bg-muted/55 hover:bg-card"}`}>
                <div className="relative aspect-[4/3] bg-muted">
                  {preview && <img src={preview} alt="" className="h-full w-full object-cover" />}
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{index + 1}</span>
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-semibold">{item.roomName}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{STATUS_LABELS[status]}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selectedItem && (
        <div className="mt-5 grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="min-w-0">
            {selectedVersion?.url ? (
              <BeforeAfter beforeUrl={selectedItem.originalUrl} afterUrl={selectedVersion.url} />
            ) : selectedItem.originalUrl ? (
              <div className="flex min-h-[52vh] items-center justify-center overflow-hidden rounded-2xl bg-[#1b1917] p-3 shadow-[var(--shadow-surface)]">
                <img src={selectedItem.originalUrl} alt="Untouched original listing photo" className="max-h-[70vh] max-w-full object-contain" />
              </div>
            ) : (
              <div className="flex min-h-[52vh] items-center justify-center rounded-2xl bg-muted text-sm text-muted-foreground">Image unavailable</div>
            )}
            <div className="mt-3 flex items-center justify-between gap-3">
              <Button type="button" size="sm" variant="outline" onClick={() => move(-1)} disabled={filtered.length < 2}>← Previous</Button>
              <p className="text-xs text-muted-foreground">{activeIndex + 1} of {filtered.length} shown · Arrow keys move</p>
              <Button type="button" size="sm" variant="outline" onClick={() => move(1)} disabled={filtered.length < 2}>Next →</Button>
            </div>
          </div>

          <aside className="ls-surface min-w-0 p-4 sm:p-5 lg:sticky lg:top-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full bg-muted px-2.5 py-1 text-[0.68rem] font-semibold">{STATUS_LABELS[selectedStatus]}</span>
              <span className="text-xs text-muted-foreground">{selectedItem.roomName}</span>
            </div>
            <h2 className="mt-3 truncate text-xl font-semibold tracking-[-0.025em]">{selectedItem.filename}</h2>

            <label htmlFor="proof-version" className="mt-5 block text-xs font-semibold">Version to review</label>
            <Select id="proof-version" value={selectedVersionId} onChange={(event) => {
              setVersionByPhoto((current) => ({ ...current, [selectedItem.id]: event.target.value }))
              setReviewNote("")
              setError(null)
            }} className="mt-2">
              <option value={ORIGINAL_SELECTION}>Untouched original</option>
              {sortedProofingVersions(selectedItem.versions).reverse().map((version) => (
                <option key={version.id} value={version.id} data-description={`v${version.versionNumber}${version.reviewState === "needs_changes" ? " · Needs changes" : ""}`}>
                  {versionLabel(version)}
                </option>
              ))}
            </Select>

            <div className="mt-4 border-l-2 border-border pl-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                {selectedQa === "review" ? "Review recommended" : selectedQa === "ready" ? "Ready for MLS" : "Untouched original"}
              </p>
              {selectedVersion?.qaNote && <p className="mt-1">{selectedVersion.qaNote}</p>}
              {selectedVersion?.reviewNote && <p className="mt-1">Review note: {selectedVersion.reviewNote}</p>}
              {selectedItem.groups.some((group) => group.status === "running" || group.status === "queued") && <p className="mt-1">New work is still processing; this available version can be reviewed now.</p>}
              {selectedItem.groups.some((group) => group.status === "failed") && <p className="mt-1 text-destructive">One edit needs attention. Existing versions and the original remain available.</p>}
            </div>

            <Button className="mt-5 w-full" onClick={() => saveReview("approve")} disabled={busy || Boolean(selectedItem.final && (selectedItem.final.outputVersionId ?? ORIGINAL_SELECTION) === selectedVersionId)}>
              {busy ? "Saving…" : selectedItem.final ? "Replace approved final" : "Approve final"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">This is the only action that selects a delivery final.</p>

            {selectedVersion && (
              <div className="mt-5 border-t border-border/60 pt-4">
                <label htmlFor="proof-note" className="text-xs font-semibold">What needs to change? <span className="font-normal text-muted-foreground">Optional</span></label>
                <Textarea id="proof-note" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={2000} rows={3} className="mt-2" placeholder="e.g. Make the window less blue" />
                <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => saveReview("needs_changes")} disabled={busy}>Needs changes</Button>
              </div>
            )}

            {selectedVersion && (
              <div className="mt-5 grid gap-2 border-t border-border/60 pt-4 text-sm">
                <Link href={`/listings/${listingId}/f/${selectedVersion.fileGroupId}?version=${selectedVersion.id}`} className="underline underline-offset-4">Open edit and refine →</Link>
                <a href={`/api/file-groups/${selectedVersion.fileGroupId}/download?version=${selectedVersion.id}`} className="underline underline-offset-4">Download this version</a>
              </div>
            )}
            {!selectedVersion && selectedItem.groups[0] && (
              <a href={`/api/file-groups/${selectedItem.groups[0].id}/download?variant=original`} className="mt-5 block text-sm underline underline-offset-4">Download original</a>
            )}
            {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
          </aside>
        </div>
      )}
    </section>
  )
}
