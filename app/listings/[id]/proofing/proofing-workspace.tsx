"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BeforeAfter } from "@/components/before-after"
import { WorkflowConnectivity } from "@/components/workflow-connectivity"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import type { ProofingItemRow, ProofingScopedReworkRow, ProofingVersionRow } from "@/lib/proofing-server"
import { automaticVersionLabel, formatGenerationCost } from "@/lib/versioning"
import {
  protectedGeometryLabel,
  validateScopedReworkInput,
  type ScopedReworkMethod,
} from "@/lib/scoped-rework"
import { connectionFailureMessage, workflowFailureMessage } from "@/lib/workflow-recovery"

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
  return automaticVersionLabel({
    versionLabel: version.versionLabel,
    parentVersionId: version.parentVersionId,
    versionNumber: version.versionNumber,
    variationIndex: version.variationIndex,
  })
}

function proofingDraftKey(listingId: string) {
  return `listing-studio:proofing-draft:v1:${listingId}`
}

export function ProofingWorkspace({
  listingId,
  items,
  scopedReworks,
  initialPhotoId,
}: {
  listingId: string
  items: ProofingItemRow[]
  scopedReworks: ProofingScopedReworkRow[]
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
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchTargets, setBatchTargets] = useState<Record<string, { versionId: string; exception: string }>>({})
  const [batchMethod, setBatchMethod] = useState<ScopedReworkMethod>("explicit")
  const [batchScopeId, setBatchScopeId] = useState<string | null>(null)
  const [batchCorrection, setBatchCorrection] = useState("")
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [batchNotice, setBatchNotice] = useState<string | null>(null)
  const [optimisticBatch, setOptimisticBatch] = useState<ProofingScopedReworkRow | null>(null)
  const [retryingGroupId, setRetryingGroupId] = useState<string | null>(null)
  const [reviewRetry, setReviewRetry] = useState<{ key: string; id: string } | null>(null)
  const [batchRetry, setBatchRetry] = useState<{ key: string; id: string } | null>(null)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [imageRetryKey, setImageRetryKey] = useState(0)
  const draftLoadedRef = useRef(false)
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
    if (draftLoadedRef.current) return
    draftLoadedRef.current = true
    try {
      const raw = localStorage.getItem(proofingDraftKey(listingId))
      if (raw) {
        const draft = JSON.parse(raw) as {
          selectedPhotoId?: string
          versionByPhoto?: Record<string, string>
          reviewNote?: string
          batchTargets?: Record<string, { versionId: string; exception: string }>
          batchMethod?: ScopedReworkMethod
          batchScopeId?: string | null
          batchCorrection?: string
          reviewRetry?: { key: string; id: string } | null
          batchRetry?: { key: string; id: string } | null
        }
        if (draft.selectedPhotoId && items.some((item) => item.id === draft.selectedPhotoId)) setSelectedPhotoId(draft.selectedPhotoId)
        if (draft.versionByPhoto) {
          setVersionByPhoto((current) => Object.fromEntries(items.map((item) => {
            const candidate = draft.versionByPhoto?.[item.id]
            const valid = candidate === ORIGINAL_SELECTION || item.versions.some((version) => version.id === candidate)
            return [item.id, valid && candidate ? candidate : current[item.id] ?? initialProofingSelection(stateInput(item))]
          })))
        }
        if (typeof draft.reviewNote === "string") setReviewNote(draft.reviewNote.slice(0, 2000))
        if (draft.batchTargets) {
          setBatchTargets(Object.fromEntries(Object.entries(draft.batchTargets).filter(([photoId, target]) => {
            const item = items.find((candidate) => candidate.id === photoId)
            return item?.versions.some((version) => version.id === target.versionId)
          })))
        }
        if (["explicit", "room", "same_room_group"].includes(draft.batchMethod ?? "")) setBatchMethod(draft.batchMethod!)
        setBatchScopeId(draft.batchScopeId ?? null)
        if (typeof draft.batchCorrection === "string") setBatchCorrection(draft.batchCorrection.slice(0, 1000))
        setReviewRetry(draft.reviewRetry ?? null)
        setBatchRetry(draft.batchRetry ?? null)
      }
    } catch {
      localStorage.removeItem(proofingDraftKey(listingId))
    } finally {
      setDraftHydrated(true)
    }
  }, [items, listingId])

  useEffect(() => {
    if (!draftHydrated) return
    localStorage.setItem(proofingDraftKey(listingId), JSON.stringify({
      selectedPhotoId,
      versionByPhoto,
      reviewNote,
      batchTargets,
      batchMethod,
      batchScopeId,
      batchCorrection,
      reviewRetry,
      batchRetry,
    }))
  }, [batchCorrection, batchMethod, batchRetry, batchScopeId, batchTargets, draftHydrated, listingId, reviewNote, reviewRetry, selectedPhotoId, versionByPhoto])

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
  useEffect(() => {
    setImageFailed(false)
  }, [selectedItem?.id, selectedItem?.originalUrl, selectedVersion?.url, selectedVersionId])
  const counts = proofingApprovalCounts(items.map(stateInput))
  const activeIndex = Math.max(0, filtered.findIndex((item) => item.id === selectedItem?.id))
  const selectedBatchEntries = items.flatMap((item) => {
    const draft = batchTargets[item.id]
    const version = draft ? item.versions.find((candidate) => candidate.id === draft.versionId) : null
    return draft && version ? [{ item, draft, version }] : []
  })
  const batchGenerationCost = selectedBatchEntries.reduce(
    (sum, entry) => sum + entry.version.generationCostCents,
    0
  )
  const visibleScopedReworks = optimisticBatch && !scopedReworks.some((request) => request.id === optimisticBatch.id)
    ? [optimisticBatch, ...scopedReworks]
    : scopedReworks
  const signInHref = `/login?next=${encodeURIComponent(`/listings/${listingId}/proofing${selectedItem ? `?photo=${selectedItem.id}` : ""}`)}`

  function preferredBatchVersion(item: ProofingItemRow) {
    const current = versionByPhoto[item.id]
    if (current && current !== ORIGINAL_SELECTION && item.versions.some((version) => version.id === current)) return current
    if (item.final?.outputVersionId && item.versions.some((version) => version.id === item.final?.outputVersionId)) {
      return item.final.outputVersionId
    }
    return sortedProofingVersions(item.versions)[0]?.id ?? null
  }

  function applyBatchScope(method: ScopedReworkMethod, scopeId: string | null, candidates: ProofingItemRow[]) {
    const next: Record<string, { versionId: string; exception: string }> = {}
    for (const item of candidates) {
      const versionId = preferredBatchVersion(item)
      if (versionId) next[item.id] = { versionId, exception: batchTargets[item.id]?.exception ?? "" }
    }
    setBatchMethod(method)
    setBatchScopeId(scopeId)
    setBatchTargets(next)
    setBatchError(Object.keys(next).length < 2 ? "This scope needs at least two generated results." : null)
    setBatchNotice(null)
  }

  function toggleBatchTarget(item: ProofingItemRow) {
    const existing = batchTargets[item.id]
    if (existing) {
      const next = { ...batchTargets }
      delete next[item.id]
      setBatchTargets(next)
    } else {
      const versionId = preferredBatchVersion(item)
      if (!versionId) return
      setBatchTargets((current) => ({ ...current, [item.id]: { versionId, exception: "" } }))
    }
    setBatchMethod("explicit")
    setBatchScopeId(null)
    setBatchError(null)
    setBatchNotice(null)
  }

  async function submitBatchRework() {
    if (batchBusy) return
    let input
    try {
      const targets = selectedBatchEntries.map(({ item, draft }) => ({
        sourcePhotoId: item.id,
        sourceOutputVersionId: draft.versionId,
        exception: draft.exception,
      }))
      const preflight = {
        selectionMethod: batchMethod,
        scopeId: batchScopeId,
        instructions: batchCorrection,
        targets,
      }
      const payloadKey = JSON.stringify(preflight)
      const requestId = batchRetry?.key === payloadKey
        ? batchRetry.id
        : crypto.randomUUID()
      setBatchRetry({ key: payloadKey, id: requestId })
      input = validateScopedReworkInput({ ...preflight, requestId })
    } catch (validationError) {
      setBatchError(validationError instanceof Error ? validationError.message : "Review the batch scope.")
      return
    }

    setBatchBusy(true)
    setBatchError(null)
    setBatchNotice(null)
    try {
      const response = await fetch(`/api/listings/${listingId}/batch-rework`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setBatchError(workflowFailureMessage({
          status: response.status,
          serverMessage: data?.error,
          fallback: "The batch refinement could not be started.",
          preserved: "Your exact targets, correction, exceptions, and retry identity are preserved.",
        }))
        return
      }
      const submittedEntries = [...selectedBatchEntries]
      setOptimisticBatch({
        id: data.requestId,
        instructions: input.instructions,
        selectionMethod: input.selectionMethod,
        scopeId: input.scopeId,
        targetCount: submittedEntries.length,
        generationCount: data.requestedGenerationCount,
        generationCostCents: data.generationCostCents,
        createdAt: new Date().toISOString(),
        targets: submittedEntries.map(({ item, draft, version }, position) => ({
          position,
          sourcePhotoId: item.id,
          sourceOutputVersionId: draft.versionId,
          fileGroupId: data.fileGroupIds[position],
          exception: draft.exception.trim() || null,
          protectedGeometry: version.protectedGeometry,
          status: "queued",
          error: null,
        })),
      })
      setBatchRetry(null)
      setBatchNotice(`${data.requestedGenerationCount} refinements started. Each photo will report its own result.`)
      setBatchTargets({})
      setBatchCorrection("")
      setBatchMethod("explicit")
      setBatchScopeId(null)
      router.refresh()
    } catch {
      setBatchError(connectionFailureMessage("Your exact targets, correction, exceptions, and retry identity are preserved."))
    } finally {
      setBatchBusy(false)
    }
  }

  async function retryBatchTarget(fileGroupId: string) {
    if (retryingGroupId) return
    setRetryingGroupId(fileGroupId)
    setBatchError(null)
    try {
      const response = await fetch(`/api/file-groups/${fileGroupId}/rerun`, { method: "POST" })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setBatchError(workflowFailureMessage({ status: response.status, serverMessage: data?.error, fallback: "This photo could not be retried.", preserved: "Every ready sibling and approved final is preserved." }))
        return
      }
      router.refresh()
    } catch {
      setBatchError(connectionFailureMessage("Every ready sibling and approved final is preserved."))
    } finally {
      setRetryingGroupId(null)
    }
  }

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
    const requestId = reviewRetry?.key === payloadKey ? reviewRetry.id : crypto.randomUUID()
    setReviewRetry({ key: payloadKey, id: requestId })
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
        setError(workflowFailureMessage({ status: response.status, serverMessage: data?.error, fallback: "The review decision could not be saved.", preserved: "Your selected photo, version, note, and existing approved final are preserved." }))
        return
      }
      setReviewRetry(null)
      setReviewNote("")
      router.refresh()
      if (action === "approve" && filtered.length > 1) move(1)
    } catch {
      setError(connectionFailureMessage("Your selected photo, version, note, and existing approved final are preserved."))
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
      <WorkflowConnectivity preserved="Your selected versions, review note, batch-refinement draft, and approved finals are preserved." />
      <div className="ls-surface flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        <div>
          <p className="text-2xl font-semibold tracking-[-0.03em]">{counts.approved} of {counts.total} approved</p>
          <p className="mt-1 text-xs text-muted-foreground">Only an explicit approval counts. New refinements never move a final.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => { setBatchOpen((open) => !open); setBatchError(null) }}>
            {batchOpen ? "Close batch refine" : "Refine several photos"}
          </Button>
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

      {batchOpen && (
        <section aria-label="Scoped batch refinement" className="ls-surface mt-4 min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.025em]">Refine an exact set</h2>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                Choose the exact saved result for each photo. No selection never means all, and new results never replace approved finals.
              </p>
            </div>
            <p className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
              {selectedBatchEntries.length} selected
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2" aria-label="Batch scope shortcuts">
            {selectedItem && (
              <Button type="button" size="sm" variant="outline" onClick={() => {
                const versionId = preferredBatchVersion(selectedItem)
                if (!versionId) return
                setBatchTargets((current) => ({ ...current, [selectedItem.id]: current[selectedItem.id] ?? { versionId, exception: "" } }))
                setBatchMethod("explicit")
                setBatchScopeId(null)
                setBatchError(null)
              }} disabled={selectedItem.versions.length === 0}>Add current photo</Button>
            )}
            {selectedItem?.roomId && (
              <Button type="button" size="sm" variant="outline" onClick={() => applyBatchScope(
                "room",
                selectedItem.roomId,
                items.filter((item) => item.roomId === selectedItem.roomId)
              )}>Use {selectedItem.roomName} room</Button>
            )}
            {selectedItem?.sameRoomGroupId && (
              <Button type="button" size="sm" variant="outline" onClick={() => applyBatchScope(
                "same_room_group",
                selectedItem.sameRoomGroupId,
                items.filter((item) => item.sameRoomGroupId === selectedItem.sameRoomGroupId)
              )}>Use {selectedItem.sameRoomGroupName ?? "same-room views"}</Button>
            )}
            {selectedBatchEntries.length > 0 && (
              <Button type="button" size="sm" variant="ghost" onClick={() => {
                setBatchTargets({})
                setBatchMethod("explicit")
                setBatchScopeId(null)
                setBatchError(null)
                setBatchNotice(null)
              }}>Clear selection</Button>
            )}
          </div>

          <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const draft = batchTargets[item.id]
              const preview = previewFor(item)
              return (
                <div key={item.id} className={`min-w-0 rounded-xl border p-3 ${draft ? "border-primary bg-card" : "border-border/70 bg-muted/25"}`}>
                  <label className={`flex min-h-10 items-center gap-3 ${item.versions.length ? "cursor-pointer" : "opacity-55"}`}>
                    <input type="checkbox" checked={Boolean(draft)} onChange={() => toggleBatchTarget(item)} disabled={item.versions.length === 0} className="size-4 shrink-0 accent-[var(--primary)]" />
                    <span className="size-12 shrink-0 overflow-hidden rounded-md bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URLs expire */}
                      {preview && <img src={preview} alt="" className="h-full w-full object-cover" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{item.filename}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.roomName}{item.versions.length ? "" : " · No generated result"}</span>
                    </span>
                  </label>
                  {draft && (
                    <div className="mt-3 border-t border-border/60 pt-3">
                      <label htmlFor={`batch-version-${item.id}`} className="text-xs font-semibold">Exact source version</label>
                      <Select id={`batch-version-${item.id}`} value={draft.versionId} onChange={(event) => {
                        setBatchTargets((current) => ({
                          ...current,
                          [item.id]: { ...current[item.id], versionId: event.target.value },
                        }))
                        setBatchMethod("explicit")
                        setBatchScopeId(null)
                        setBatchNotice(null)
                      }} className="mt-1.5">
                        {sortedProofingVersions(item.versions).map((version) => (
                          <option key={version.id} value={version.id}>
                            {versionLabel(version)}{item.final?.outputVersionId === version.id ? " · Approved" : ""}
                          </option>
                        ))}
                      </Select>
                      {(() => {
                        const version = item.versions.find((candidate) => candidate.id === draft.versionId)
                        return version ? <p className="mt-2 text-[0.7rem] text-muted-foreground">Protected: {protectedGeometryLabel(version.protectedGeometry)}.</p> : null
                      })()}
                      <label htmlFor={`batch-exception-${item.id}`} className="mt-3 block text-xs font-semibold">Target-specific exception <span className="font-normal text-muted-foreground">Optional</span></label>
                      <Input id={`batch-exception-${item.id}`} value={draft.exception} maxLength={500} onChange={(event) => {
                        setBatchTargets((current) => ({ ...current, [item.id]: { ...current[item.id], exception: event.target.value } }))
                        setBatchNotice(null)
                      }} placeholder="e.g. Keep this porch light warm" className="mt-1.5" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
            <div>
              <label htmlFor="batch-correction" className="text-sm font-semibold">What should change across these results?</label>
              <Textarea id="batch-correction" value={batchCorrection} onChange={(event) => { setBatchCorrection(event.target.value); setBatchNotice(null) }} maxLength={1000} rows={3} className="mt-2" placeholder="e.g. Make the blue sky a little softer and more natural" />
            </div>
            <div className="min-w-0 rounded-xl bg-muted/50 p-3">
              <p className="text-sm font-semibold">{selectedBatchEntries.length} initial generation{selectedBatchEntries.length === 1 ? "" : "s"} · {formatGenerationCost(batchGenerationCost)}</p>
              <p className="mt-1 text-xs text-muted-foreground">One child per exact source. Provider retries and any QA correction are counted separately only if needed.</p>
              <Button type="button" className="mt-3 w-full" onClick={submitBatchRework} disabled={batchBusy || selectedBatchEntries.length < 2 || !batchCorrection.trim()}>
                {batchBusy ? "Starting batch refinement…" : `Start on ${selectedBatchEntries.length} photos`}
              </Button>
            </div>
          </div>
          {batchError && (
            <div role="alert" className="mt-3 text-sm text-destructive">
              <p>{batchError}</p>
              {/sign-in expired/i.test(batchError) && <Link href={signInHref} className="mt-2 inline-flex min-h-10 items-center font-semibold underline underline-offset-4">Sign in again</Link>}
            </div>
          )}
          {batchNotice && <p role="status" className="mt-3 text-sm font-medium">{batchNotice}</p>}
        </section>
      )}

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
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URLs expire */}
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

      {visibleScopedReworks.length > 0 && (
        <section aria-label="Recent batch refinements" className="mt-5 border-y border-border/70 py-4">
          <h2 className="text-sm font-semibold">Recent batch refinements</h2>
          <div className="mt-3 grid gap-3">
            {visibleScopedReworks.map((request) => {
              const ready = request.targets.filter((target) => target.status === "complete").length
              const failed = request.targets.filter((target) => target.status === "failed").length
              const active = request.targets.length - ready - failed
              return (
                <details key={request.id} className="rounded-xl border border-border/70 bg-card p-3" open={visibleScopedReworks[0]?.id === request.id}>
                  <summary className="cursor-pointer list-none text-sm font-semibold">
                    {request.instructions} · {ready} ready{active ? ` · ${active} editing` : ""}{failed ? ` · ${failed} needs attention` : ""}
                  </summary>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {request.generationCount} initial generations · {formatGenerationCost(request.generationCostCents)}. Approved finals stay unchanged.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {request.targets.map((target) => {
                      const item = items.find((candidate) => candidate.id === target.sourcePhotoId)
                      const source = item?.versions.find((version) => version.id === target.sourceOutputVersionId)
                      const status = target.status === "complete" ? "Ready" : target.status === "failed" ? "Needs attention" : "Editing"
                      return (
                        <div key={target.fileGroupId} className="min-w-0 rounded-lg bg-muted/45 p-3 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-semibold">{item?.filename ?? "Photo"}</p>
                              <p className="mt-0.5 truncate text-muted-foreground">From {source ? versionLabel(source) : "exact saved version"}</p>
                            </div>
                            <span className={target.status === "failed" ? "font-semibold text-destructive" : "font-semibold"}>{status}</span>
                          </div>
                          {target.exception && <p className="mt-2 text-muted-foreground">Exception: {target.exception}</p>}
                          {target.error && <p className="mt-2 text-destructive">{target.error}</p>}
                          <div className="mt-2 flex flex-wrap gap-3">
                            <Link href={`/listings/${listingId}/f/${target.fileGroupId}`} className="underline underline-offset-4">Open result</Link>
                            {target.status === "failed" && (
                              <button type="button" onClick={() => retryBatchTarget(target.fileGroupId)} disabled={Boolean(retryingGroupId)} className="font-semibold underline underline-offset-4 disabled:opacity-50">
                                {retryingGroupId === target.fileGroupId ? "Retrying…" : "Try again"}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </details>
              )
            })}
          </div>
        </section>
      )}

      {selectedItem && (
        <div className="mt-5 grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="min-w-0">
            {imageFailed ? (
              <div className="flex min-h-[52vh] items-center justify-center overflow-hidden rounded-2xl bg-[#1b1917] p-5 text-center text-white shadow-[var(--shadow-surface)]">
                <div className="max-w-sm rounded-xl border border-white/20 bg-black/65 px-5 py-4 backdrop-blur-xl">
                  <p className="font-semibold">This secure image link expired</p>
                  <p className="mt-1 text-xs text-white/70">The photo, selected version, review note, and approved final are still saved. Refresh the image link and continue.</p>
                  <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => {
                    setImageFailed(false)
                    setImageRetryKey((value) => value + 1)
                    router.refresh()
                  }}>Retry image</Button>
                </div>
              </div>
            ) : selectedVersion?.url ? (
              <BeforeAfter key={`${selectedItem.id}:${selectedVersion.id}:${imageRetryKey}`} beforeUrl={selectedItem.originalUrl} afterUrl={selectedVersion.url} onBeforeError={() => setImageFailed(true)} onAfterError={() => setImageFailed(true)} />
            ) : selectedItem.originalUrl ? (
              <div className="flex min-h-[52vh] items-center justify-center overflow-hidden rounded-2xl bg-[#1b1917] p-3 shadow-[var(--shadow-surface)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URLs expire */}
                <img key={`${selectedItem.id}:${imageRetryKey}`} src={selectedItem.originalUrl} alt="Untouched original listing photo" onError={() => setImageFailed(true)} className="max-h-[70vh] max-w-full object-contain" />
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
                  {versionLabel(version)} · {version.jobTitle}
                </option>
              ))}
            </Select>

            <div className="mt-4 border-l-2 border-border pl-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                {selectedQa === "review" ? "Review recommended" : selectedQa === "ready" ? "Ready for MLS" : "Untouched original"}
              </p>
              {selectedVersion?.qaNote && <p className="mt-1">{selectedVersion.qaNote}</p>}
              {selectedVersion?.reviewNote && <p className="mt-1">Review note: {selectedVersion.reviewNote}</p>}
              {selectedVersion && <p className="mt-1">{selectedVersion.parentVersionId ? "This is a saved branch from an earlier version." : "This is the first result in its branch."}</p>}
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
            {error && (
              <div role="alert" className="mt-4 text-sm text-destructive">
                <p>{error}</p>
                {/sign-in expired/i.test(error) && <Link href={signInHref} className="mt-2 inline-flex min-h-10 items-center font-semibold underline underline-offset-4">Sign in again</Link>}
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}
