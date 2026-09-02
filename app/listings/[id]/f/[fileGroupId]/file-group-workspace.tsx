"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Disclosure } from "@/components/ui/disclosure"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { StatePill } from "@/components/brand"
import { BeforeAfter } from "@/components/before-after"
import { WorkflowConnectivity } from "@/components/workflow-connectivity"
import { TourViewer } from "@/components/tour-viewer"
import {
  automaticVersionLabel,
  branchContext,
  formatGenerationCost,
} from "@/lib/versioning"
import { connectionFailureMessage, workflowCatchMessage, workflowFailureMessage } from "@/lib/workflow-recovery"
import { EDIT_TYPES } from "../../edit-types"
import type { ComplianceNote } from "../../job-feed"

const EDIT_360_TYPES = ["360_IMAGE_ENHANCEMENT", "360_ITEM_REMOVAL", "360_VIRTUAL_STAGING"]
const STAGED_TYPES = ["VIRTUAL_STAGING", "VIRTUAL_RENOVATION"]

const DOWNLOAD_VARIANTS: [string, string][] = [
  ["", "Recommended size"],
  ["original", "Original photo"],
  ["full", "Full-resolution edit"],
  ["web1920", "Web · 1920px"],
  ["under_10mb", "MLS · under 10MB"],
  ["under_5mb", "MLS · under 5MB"],
]

const DUSK_CHECKS = [
  "No windows glowing in rooms that were dark in the original",
  "Dusk sky consistent with the shadow direction",
]

export type WorkspaceFileGroup = {
  id: string
  primary_photo_id: string
  current_step: number
  step_status: string
  last_error: string | null
  comment: string | null
  edit_chain: { edit_type: string; options?: Record<string, unknown> }[]
  output_versions: {
    id: string
    file_group_id: string
    job_title: string
    version_number: number
    version_label: string | null
    parent_version_id: string | null
    variation_index: number | null
    created_at: string
    group_status: string
    group_error: string | null
    edit_chain: { edit_type: string; options?: Record<string, unknown> }[]
    generation_cost_cents: number
    qa_note: string | null
    compliance: ComplianceNote
    review_state: "unreviewed" | "needs_changes" | "approved"
    review_note: string | null
    reviewed_at: string | null
    url: string | null
  }[]
  final: {
    id: string
    output_version_id: string | null
    selected_at: string
  } | null
  chat_messages: { role: string; content: string; created_at: string }[]
}

export type BeforePhoto = { url: string | null; width: number | null }
type Sibling = { id: string; step_status: string; url: string | null }

function statusCopy(status: string, hasOutput: boolean) {
  if (status === "failed") return { label: "Needs attention", heading: "This edit needs another try" }
  if (status === "complete") return { label: "Ready", heading: "Your photo is ready" }
  if (hasOutput) return { label: "Refining", heading: "Creating a new version" }
  if (status === "queued") return { label: "Preparing", heading: "Preparing your edit" }
  return { label: "Editing", heading: "Editing your photo" }
}

function editOrder(chain: WorkspaceFileGroup["edit_chain"]) {
  return chain
    .filter((step) => step.edit_type !== "REWORK")
    .map((step) => EDIT_TYPES[step.edit_type]?.label ?? step.edit_type.replaceAll("_", " "))
    .join(" → ")
}

function workspaceDraftKey(fileGroupId: string) {
  return `listing-studio:result-draft:v1:${fileGroupId}`
}

export function FileGroupWorkspace({ listingId, fg, before, siblings, initialVersionId }: {
  listingId: string
  fg: WorkspaceFileGroup
  before: BeforePhoto
  siblings: Sibling[]
  initialVersionId?: string
}) {
  const router = useRouter()
  const [selectedVersionId, setSelectedVersionId] = useState(initialVersionId ?? "")
  const [reworkText, setReworkText] = useState("")
  const [reworking, setReworking] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dlVariant, setDlVariant] = useState("")
  const [dlWatermark, setDlWatermark] = useState<boolean | null>(null)
  const [preview360, setPreview360] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [attached, setAttached] = useState(false)
  const [resultImageFailed, setResultImageFailed] = useState(false)
  const [imageRetryKey, setImageRetryKey] = useState(0)
  const [reviewNote, setReviewNote] = useState("")
  const [reviewing, setReviewing] = useState(false)
  const [versionName, setVersionName] = useState("")
  const [naming, setNaming] = useState(false)
  const [compareLeftId, setCompareLeftId] = useState("")
  const [compareRightId, setCompareRightId] = useState("")
  const [comparing, setComparing] = useState(false)
  const [variationCount, setVariationCount] = useState(2)
  const [variationText, setVariationText] = useState("")
  const [variationLabels, setVariationLabels] = useState(["Direction A", "Direction B", "Direction C", "Direction D"])
  const [creatingVariations, setCreatingVariations] = useState(false)
  const [variationRequest, setVariationRequest] = useState<{ key: string; id: string } | null>(null)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const draftLoadedRef = useRef(false)

  const versionsDesc = [...fg.output_versions].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const latest = versionsDesc.find((version) => version.id === selectedVersionId) ?? versionsDesc[0]
  const namedVersions = versionsDesc.map((version) => ({
    ...version,
    displayLabel: automaticVersionLabel({
      versionLabel: version.version_label,
      parentVersionId: version.parent_version_id,
      versionNumber: version.version_number,
      variationIndex: version.variation_index,
    }),
  }))
  const selectedNamed = namedVersions.find((version) => version.id === latest?.id)
  const settled = ["complete", "failed"].includes(latest?.group_status ?? fg.step_status)
  const currentSettled = ["complete", "failed"].includes(fg.step_status)
  const currentActive = !currentSettled
  const currentFailed = fg.step_status === "failed"
  const currentOwnsStatus = currentActive || currentFailed
  const selectedChain = latest?.edit_chain ?? fg.edit_chain
  const isPlan = selectedChain.some((step) => step.edit_type === "FLOOR_PLAN_REDRAW")
  const isDusk = selectedChain.some(
    (step) => step.edit_type === "DAY_TO_DUSK" && (step.options?.preset ?? "dusk") === "dusk"
  )
  const is360 = selectedChain.some((step) => EDIT_360_TYPES.includes(step.edit_type))
  const staged = selectedChain.some((step) => STAGED_TYPES.includes(step.edit_type))
  const thread = [...(fg.chat_messages ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const selectedIsFinal = Boolean(latest && fg.final?.output_version_id === latest.id)
  const copy = currentOwnsStatus
    ? statusCopy(fg.step_status, Boolean(latest?.url))
    : selectedIsFinal
      ? { label: "Approved final", heading: "This version is the approved final" }
      : statusCopy(latest?.group_status ?? fg.step_status, Boolean(latest?.url))
  const selectedSiblingIndex = Math.max(0, siblings.findIndex((item) => item.id === fg.id))
  const compareLeft = namedVersions.find((version) => version.id === compareLeftId) ?? null
  const compareRight = namedVersions.find((version) => version.id === compareRightId) ?? null
  const comparisonReady = Boolean(compareLeft?.url && compareRight?.url && compareLeft?.id !== compareRight?.id)
  const variationCost = (latest?.generation_cost_cents ?? 0) * variationCount
  const fallbackCompareId = latest?.parent_version_id
    ?? namedVersions.find((version) => version.id !== latest?.id)?.id
    ?? ""

  useEffect(() => {
    setVersionName(latest?.version_label ?? "")
    setCompareRightId((current) => current || latest?.id || "")
    setCompareLeftId((current) => current || fallbackCompareId)
  }, [fallbackCompareId, latest?.id, latest?.version_label])

  useEffect(() => {
    if (draftLoadedRef.current) return
    draftLoadedRef.current = true
    try {
      const raw = localStorage.getItem(workspaceDraftKey(fg.id))
      if (raw) {
        const draft = JSON.parse(raw) as {
          selectedVersionId?: string
          reworkText?: string
          reviewNote?: string
          versionName?: string
          variationCount?: number
          variationText?: string
          variationLabels?: string[]
          variationRequest?: { key: string; id: string } | null
        }
        if (!initialVersionId && draft.selectedVersionId && fg.output_versions.some((version) => version.id === draft.selectedVersionId)) setSelectedVersionId(draft.selectedVersionId)
        if (typeof draft.reworkText === "string") setReworkText(draft.reworkText)
        if (typeof draft.reviewNote === "string") setReviewNote(draft.reviewNote)
        if (typeof draft.versionName === "string") setVersionName(draft.versionName)
        if ([2, 3, 4].includes(draft.variationCount ?? 0)) setVariationCount(draft.variationCount!)
        if (typeof draft.variationText === "string") setVariationText(draft.variationText)
        if (Array.isArray(draft.variationLabels) && draft.variationLabels.length === 4) setVariationLabels(draft.variationLabels.map((label) => String(label).slice(0, 80)))
        setVariationRequest(draft.variationRequest ?? null)
      }
    } catch {
      localStorage.removeItem(workspaceDraftKey(fg.id))
    } finally {
      setDraftHydrated(true)
    }
  }, [fg.id, fg.output_versions, initialVersionId])

  useEffect(() => {
    if (!draftHydrated) return
    localStorage.setItem(workspaceDraftKey(fg.id), JSON.stringify({
      selectedVersionId,
      reworkText,
      reviewNote,
      versionName,
      variationCount,
      variationText,
      variationLabels,
      variationRequest,
    }))
  }, [draftHydrated, fg.id, reviewNote, reworkText, selectedVersionId, variationCount, variationLabels, variationRequest, variationText, versionName])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`fg-${fg.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "file_groups" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "output_versions" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `file_group_id=eq.${fg.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "photo_finals", filter: `listing_id=eq.${listingId}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "variation_requests", filter: `listing_id=eq.${listingId}` }, () => router.refresh())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fg.id, listingId, router])

  async function saveReview(action: "approve" | "needs_changes") {
    if (!latest || reviewing) return
    setReviewing(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/listings/${listingId}/proofing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          sourcePhotoId: fg.primary_photo_id,
          action,
          outputVersionId: latest.id,
          note: action === "needs_changes" ? reviewNote.trim() : null,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setActionError(workflowFailureMessage({ status: response.status, serverMessage: data?.error, fallback: "The review decision could not be saved.", preserved: "Your note, selected version, and current approved final are preserved." }))
        return
      }
      setReviewNote("")
      router.refresh()
    } catch {
      setActionError(connectionFailureMessage("Your note, selected version, and current approved final are preserved."))
    } finally {
      setReviewing(false)
    }
  }

  // localhost cannot receive fal webhooks. This listing-scoped endpoint uses
  // the same orchestrator transitions and production realtime remains primary.
  useEffect(() => {
    if (currentSettled) return
    let cancelled = false
    const reconcile = async () => {
      try {
        const response = await fetch(`/api/listings/${listingId}/reconcile`, { method: "POST" })
        if (!cancelled && response.ok) router.refresh()
      } catch {
        // The next poll or realtime event can recover.
      }
    }
    void reconcile()
    const timer = window.setInterval(reconcile, 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [currentSettled, listingId, router])

  async function sendRework(versionId: string | undefined) {
    const message = reworkText.trim()
    const source = versionsDesc.find((version) => version.id === versionId)
    if (!message || reworking || !source) return
    setReworking(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/file-groups/${source.file_group_id}/rework`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, versionId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setActionError(workflowFailureMessage({ status: response.status, serverMessage: data?.error, fallback: "The refinement could not be started.", preserved: "Your instruction, source version, history, and approved final are preserved." }))
        return
      }
      setReworkText("")
      setSelectedVersionId("")
      router.refresh()
    } catch {
      setActionError(connectionFailureMessage("Your instruction, source version, history, and approved final are preserved."))
    } finally {
      setReworking(false)
    }
  }

  async function rerun() {
    setActionError(null)
    try {
      const response = await fetch(`/api/file-groups/${fg.id}/rerun`, { method: "POST" })
      const data = await response.json().catch(() => null)
      if (!response.ok) setActionError(workflowFailureMessage({ status: response.status, serverMessage: data?.error, fallback: "This edit could not be restarted.", preserved: "The source photo, existing versions, and approved final are preserved." }))
      router.refresh()
    } catch {
      setActionError(connectionFailureMessage("The source photo, existing versions, and approved final are preserved."))
    }
  }

  async function attachPlan(versionId: string | undefined) {
    const source = versionsDesc.find((version) => version.id === versionId)
    if (attaching || !source) return
    setAttaching(true)
    try {
      const response = await fetch(`/api/file-groups/${source.file_group_id}/attach-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(workflowFailureMessage({ status: response.status, serverMessage: data?.error, fallback: "The plan could not be attached.", preserved: "The version and existing listing attachments are unchanged." }))
      setAttached(true)
      router.refresh()
    } catch (cause) {
      setActionError(workflowCatchMessage(cause, "The plan could not be attached.", "The version and existing listing attachments are unchanged."))
    } finally {
      setAttaching(false)
    }
  }

  const watermark = dlWatermark ?? staged
  const downloadHref = latest
    ? `/api/file-groups/${latest.file_group_id}/download?version=${latest.id}&watermark=${watermark ? 1 : 0}${dlVariant ? `&variant=${dlVariant}` : ""}`
    : "#"
  const complianceChecks = latest?.compliance?.checks ?? []
  const qaNeedsReview = Boolean(latest?.qa_note) || complianceChecks.some((check) => !check.pass)

  useEffect(() => {
    setResultImageFailed(false)
  }, [latest?.id, latest?.url])

  async function saveVersionName() {
    if (!latest || naming) return
    setNaming(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/output-versions/${latest.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: versionName }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setActionError(workflowFailureMessage({ status: response.status, serverMessage: data?.error, fallback: "The version name could not be saved.", preserved: "The version, history, and approved final are unchanged." }))
        return
      }
      router.refresh()
    } catch {
      setActionError(connectionFailureMessage("The version, history, and approved final are unchanged."))
    } finally {
      setNaming(false)
    }
  }

  async function createVariations() {
    if (!latest || creatingVariations) return
    const labels = variationLabels.slice(0, variationCount)
    const key = JSON.stringify({ versionId: latest.id, count: variationCount, instructions: variationText.trim(), labels })
    const requestId = variationRequest?.key === key ? variationRequest.id : crypto.randomUUID()
    setVariationRequest({ key, id: requestId })
    setCreatingVariations(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/output-versions/${latest.id}/variations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, count: variationCount, instructions: variationText, labels }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setActionError(workflowFailureMessage({ status: response.status, serverMessage: data?.error, fallback: "The variations could not be started.", preserved: "Your direction, option names, source version, and approved final are preserved." }))
        return
      }
      setVariationRequest(null)
      const first = data?.fileGroupIds?.[0]
      if (first) router.push(`/listings/${listingId}/f/${first}`)
      else router.refresh()
    } catch {
      setActionError(connectionFailureMessage("Your direction, option names, source version, and approved final are preserved."))
    } finally {
      setCreatingVariations(false)
    }
  }

  return (
    <div>
      <WorkflowConnectivity preserved="The source, versions, refinement text, review note, and approved final are preserved." />
      {siblings.length > 1 && (
        <nav aria-label="Photos in this edit" className="mb-4 flex items-center gap-3 overflow-x-auto rounded-2xl bg-muted/60 p-2">
          <p className="shrink-0 px-2 text-xs font-semibold text-muted-foreground">Photo {selectedSiblingIndex + 1} of {siblings.length}</p>
          <div className="flex gap-2">
            {siblings.map((sibling, index) => (
              <Link key={sibling.id} href={`/listings/${listingId}/f/${sibling.id}`} aria-current={sibling.id === fg.id ? "page" : undefined}
                className={`ls-pressable relative block h-12 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${sibling.id === fg.id ? "border-primary shadow-sm" : "border-transparent opacity-75 hover:opacity-100"}`}
                title={`Open photo ${index + 1}`}>
                {sibling.url && (
                  // eslint-disable-next-line @next/next/no-img-element -- signed listing-photo URL
                  <img src={sibling.url} alt="" className="h-full w-full object-cover" />
                )}
                <span className="absolute bottom-0 right-0 bg-black/65 px-1 text-[9px] text-white">{index + 1}</span>
              </Link>
            ))}
          </div>
        </nav>
      )}

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section aria-label="Photo result" className="min-w-0">
          {comparing && comparisonReady && compareLeft?.url && compareRight?.url ? (
            <div>
              <BeforeAfter
                key={`${compareLeft.id}:${compareRight.id}`}
                beforeUrl={compareLeft.url}
                afterUrl={compareRight.url}
                beforeLabel={compareLeft.displayLabel}
                afterLabel={compareRight.displayLabel}
                beforeAlt={`${compareLeft.displayLabel} listing-photo version`}
                afterAlt={`${compareRight.displayLabel} listing-photo version`}
                ariaLabel={`Compare ${compareLeft.displayLabel} with ${compareRight.displayLabel}`}
              />
              <div className="mt-3 flex flex-wrap items-start justify-between gap-3 text-xs text-muted-foreground">
                <p><span className="font-medium text-foreground">{compareLeft.displayLabel}</span> · {branchContext(compareLeft, namedVersions)}</p>
                <p className="text-right"><span className="font-medium text-foreground">{compareRight.displayLabel}</span> · {branchContext(compareRight, namedVersions)}</p>
              </div>
            </div>
          ) : latest?.url && !resultImageFailed ? (
            <div className="relative">
              {is360 && preview360 ? (
                <div className="h-[62vh] min-h-96 w-full overflow-hidden rounded-2xl bg-black">
                  <TourViewer scenes={[{ id: fg.id, name: "360 result", url: latest.url, width: before.width ?? 4096, initial_yaw: 0, hotspots: [] }]} activeSceneId={fg.id} />
                </div>
              ) : <BeforeAfter key={`${latest.id}:${imageRetryKey}`} beforeUrl={before.url} afterUrl={latest.url} onAfterError={() => setResultImageFailed(true)} />}
              {currentActive && (
                <div className="absolute inset-x-4 bottom-4 rounded-xl border border-white/20 bg-black/58 px-4 py-3 text-white shadow-lg backdrop-blur-xl sm:inset-x-auto sm:left-5 sm:max-w-sm">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white/78">
                    <span className="pulse-live size-2 rounded-full bg-state-running" />
                    {copy.label}
                  </div>
                  <p className="mt-1 font-semibold tracking-[-0.015em]">{copy.heading}</p>
                  <p className="mt-0.5 text-xs text-white/70">This version stays available while the refinement develops.</p>
                </div>
              )}
            </div>
          ) : resultImageFailed ? (
            <div className="relative flex min-h-[56vh] items-center justify-center overflow-hidden rounded-2xl bg-[#1b1917] p-5 shadow-[var(--shadow-surface)] sm:p-10">
              {before.url && (
                // eslint-disable-next-line @next/next/no-img-element -- signed listing-photo URL
                <img src={before.url} alt="Original photo" className="absolute inset-0 h-full w-full object-contain opacity-30" />
              )}
              <div className="relative max-w-sm rounded-xl border border-white/20 bg-black/65 px-5 py-4 text-center text-white backdrop-blur-xl">
                <p className="font-semibold">The finished image could not load</p>
                <p className="mt-1 text-xs text-white/70">The result is still saved. Refresh its secure image link and try again.</p>
                <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => {
                  setResultImageFailed(false)
                  setImageRetryKey((value) => value + 1)
                  router.refresh()
                }}>Retry image</Button>
              </div>
            </div>
          ) : (
            <div className="sweep relative flex min-h-[56vh] items-center justify-center overflow-hidden rounded-2xl bg-[#1b1917] p-5 shadow-[var(--shadow-surface)] sm:p-10">
              {before.url && (
                // eslint-disable-next-line @next/next/no-img-element -- signed listing-photo URL
                <img src={before.url} alt="Original photo" className="max-h-[70vh] w-full object-contain opacity-75" />
              )}
              <div className="absolute inset-x-4 bottom-4 rounded-xl border border-white/20 bg-black/58 px-4 py-3 text-white shadow-lg backdrop-blur-xl sm:inset-x-auto sm:left-5 sm:max-w-sm">
                <div className="flex items-center gap-2 text-xs font-semibold text-white/78">
                  <span className="pulse-live size-2 rounded-full bg-state-running" />
                  {copy.label}
                </div>
                <p className="mt-1 text-lg font-semibold tracking-[-0.025em]">{copy.heading}</p>
                <p className="mt-0.5 text-xs text-white/70">You can leave this page. The edit will keep running.</p>
              </div>
            </div>
          )}
        </section>

        <aside className="ls-surface min-w-0 p-4 sm:p-5 lg:sticky lg:top-5">
          <StatePill status={currentOwnsStatus ? fg.step_status : latest?.group_status ?? fg.step_status} label={copy.label} />
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{copy.heading}</h2>

          {fg.step_status === "failed" && (
            <div className="mt-4 border-l-2 border-state-failed pl-3">
              <p className="text-sm text-destructive">{fg.last_error ?? "The image service could not finish this edit."}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={rerun}>Try again</Button>
                <Button asChild size="sm" variant="outline"><Link href={`/listings/${listingId}`}>Back to photos</Link></Button>
              </div>
            </div>
          )}

          {latest?.url && !isPlan && (
            <section className="mt-6">
              <h3 className="text-xs font-semibold">Download</h3>
              <Select aria-label="Download size" value={dlVariant} onChange={(event) => setDlVariant(event.target.value)} className="mt-2">
                {DOWNLOAD_VARIANTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
              {dlVariant !== "original" && staged && (
                <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={watermark} onChange={(event) => setDlWatermark(event.target.checked)} className="mt-1" />Add “Virtually Staged” label</label>
              )}
              <Button asChild className="mt-3 w-full"><a href={downloadHref}>Download photo</a></Button>
              {is360 && <button type="button" onClick={() => setPreview360((value) => !value)} className="mt-2 w-full text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">{preview360 ? "Show before and after" : "Preview in 360"}</button>}
            </section>
          )}

          {latest?.url && settled && !isPlan && (
            <section className="mt-6 border-t border-border/60 pt-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold">Final selection</h3>
                <Link href={`/listings/${listingId}/proofing?photo=${fg.primary_photo_id}`} className="text-xs text-muted-foreground underline underline-offset-4">Open proofing</Link>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedIsFinal ? "This exact version is approved. Later refinements will not replace it." : "Ready to review is not approval. Choose this exact version only after checking it."}
              </p>
              <Button className="mt-3 w-full" onClick={() => saveReview("approve")} disabled={reviewing || selectedIsFinal}>
                {reviewing ? "Saving…" : fg.final ? "Replace approved final" : "Approve final"}
              </Button>
              <label htmlFor="workspace-review-note" className="mt-4 block text-xs font-semibold">What needs to change? <span className="font-normal text-muted-foreground">Optional</span></label>
              <Textarea id="workspace-review-note" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={2000} rows={2} className="mt-2" placeholder="e.g. Keep the original view through the window" />
              <Button className="mt-2 w-full" variant="outline" onClick={() => saveReview("needs_changes")} disabled={reviewing}>Needs changes</Button>
              {latest.review_state === "needs_changes" && (
                <p className="mt-2 text-xs text-destructive">Needs changes{latest.review_note ? ` — ${latest.review_note}` : ""}</p>
              )}
            </section>
          )}

          {latest?.url && isPlan && (
            <section className="mt-6">
              <h3 className="text-xs font-semibold">Export plan</h3>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["png", "svg", "pdf"] as const).map((format) => <Button key={format} asChild size="sm" variant="outline"><a href={`/api/file-groups/${latest.file_group_id}/plan-export?format=${format}&version=${latest.id}`}>{format.toUpperCase()}</a></Button>)}
              </div>
              <Button className="mt-3 w-full" variant="outline" onClick={() => attachPlan(latest.id)} disabled={attaching || attached}>{attached ? "Attached to listing ✓" : attaching ? "Attaching…" : "Attach to listing"}</Button>
            </section>
          )}

          {namedVersions.length > 0 && (
            <section className="mt-6 border-t border-border/60 pt-5">
              <h3 className="text-xs font-semibold">Versions and branches</h3>
              <div className="mt-2 grid gap-1.5">
                {namedVersions.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => { setSelectedVersionId(version.id); setComparing(false) }}
                    title={`${version.displayLabel}. ${branchContext(version, namedVersions)}`}
                    className={`ls-pressable grid min-h-12 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-2 rounded-lg p-1.5 text-left ${latest?.id === version.id && !comparing ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/60 hover:text-foreground"}`}
                  >
                    <span className="block aspect-[4/3] overflow-hidden rounded bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed output URLs expire */}
                      {version.url && <img src={version.url} alt="" className="h-full w-full object-cover" />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center justify-between gap-2"><span className="truncate text-sm">{version.displayLabel}</span>{fg.final?.output_version_id === version.id && <span className="shrink-0 text-[10px] text-state-complete">Approved</span>}</span>
                      <span className="block truncate text-[10px] font-normal text-muted-foreground">{branchContext(version, namedVersions)}</span>
                    </span>
                  </button>
                ))}
              </div>

              {selectedNamed && (
                <div className="mt-3">
                  <label htmlFor="version-name" className="text-xs font-semibold">Name this version</label>
                  <div className="mt-2 flex gap-2">
                    <Input id="version-name" value={versionName} onChange={(event) => setVersionName(event.target.value)} maxLength={80} placeholder={selectedNamed.displayLabel} />
                    <Button type="button" size="sm" variant="outline" onClick={saveVersionName} disabled={naming}>{naming ? "Saving…" : "Save"}</Button>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">Naming does not change the approved final.</p>
                </div>
              )}

              {namedVersions.length > 1 && (
                <div className="mt-4 border-t border-border/60 pt-4">
                  <h4 className="text-xs font-semibold">Compare any two</h4>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Select aria-label="Left comparison version" value={compareLeftId} onChange={(event) => setCompareLeftId(event.target.value)}>
                      {namedVersions.map((version) => <option key={version.id} value={version.id}>{version.displayLabel}</option>)}
                    </Select>
                    <Select aria-label="Right comparison version" value={compareRightId} onChange={(event) => setCompareRightId(event.target.value)}>
                      {namedVersions.map((version) => <option key={version.id} value={version.id}>{version.displayLabel}</option>)}
                    </Select>
                  </div>
                  <Button type="button" className="mt-2 w-full" variant="outline" onClick={() => setComparing((value) => !value)} disabled={!comparisonReady}>
                    {comparing ? "Return to original comparison" : "Compare these versions"}
                  </Button>
                </div>
              )}
            </section>
          )}

          {latest?.url && settled && (
            <section className="mt-6">
              <label htmlFor="refine-result" className="text-xs font-semibold">Refine this version</label>
              <p className="mt-1 text-xs text-muted-foreground">A refinement branches from {selectedNamed?.displayLabel ?? "this version"}. The source and approved final stay safe.</p>
              <Textarea id="refine-result" value={reworkText} onChange={(event) => setReworkText(event.target.value)} placeholder="What should change? e.g. use a gray sofa and remove the wall art" rows={3} className="mt-2 w-full resize-none bg-card" />
              <Button className="mt-2 w-full" variant="outline" onClick={() => sendRework(latest.id)} disabled={!reworkText.trim() || reworking}>{reworking ? "Creating version…" : "Create new version"}</Button>

              <Disclosure className="mt-3" summary="Create several variations" triggerClassName="px-0 text-xs font-semibold text-foreground" contentClassName="px-0">
                <p className="text-xs text-muted-foreground">Create independent options from this exact version. One failed option will not remove successful siblings.</p>
                <label htmlFor="variation-direction" className="mt-3 block text-xs font-semibold">Shared direction</label>
                <Textarea id="variation-direction" value={variationText} onChange={(event) => setVariationText(event.target.value)} maxLength={1000} rows={2} className="mt-2" placeholder="e.g. Try distinct warm-neutral furniture arrangements" />
                <label htmlFor="variation-count" className="mt-3 block text-xs font-semibold">Number of variations</label>
                <Select id="variation-count" value={variationCount} onChange={(event) => setVariationCount(Number(event.target.value))} className="mt-2">
                  {[2, 3, 4].map((count) => <option key={count} value={count}>{count} variations</option>)}
                </Select>
                <div className="mt-3 grid gap-2">
                  {variationLabels.slice(0, variationCount).map((label, index) => (
                    <label key={index} className="text-xs font-semibold">Option {index + 1} name
                      <Input value={label} onChange={(event) => setVariationLabels((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} maxLength={80} className="mt-1" />
                    </label>
                  ))}
                </div>
                <div className="mt-3 border-l-2 border-border pl-3 text-xs text-muted-foreground">
                  <p><span className="font-medium text-foreground">{variationCount} requested generations · {formatGenerationCost(variationCost)}</span> initial generation cost.</p>
                  <p className="mt-1">Provider retries, only if needed, are counted separately. Variations do not move the approved final.</p>
                </div>
                <Button type="button" className="mt-3 w-full" onClick={createVariations} disabled={creatingVariations || variationText.trim().length < 2 || variationLabels.slice(0, variationCount).some((label) => !label.trim())}>
                  {creatingVariations ? "Starting variations…" : `Create ${variationCount} variations · ${formatGenerationCost(variationCost)}`}
                </Button>
              </Disclosure>
            </section>
          )}

          {latest?.url && (
            <Disclosure
              className="mt-5 border-t border-border/55 pt-2"
              summary={qaNeedsReview ? "Review recommended" : "Ready for MLS"}
              triggerClassName="px-0 text-xs font-semibold text-foreground"
              contentClassName="px-0"
            >
              <div className="text-xs text-muted-foreground">
                {latest.qa_note && <p>{latest.qa_note}</p>}
                {complianceChecks.map((check) => <p key={check.id} className="mt-2 flex items-start gap-2"><span className={check.pass ? "text-state-complete" : "text-state-failed"}>{check.pass ? "✓" : "✕"}</span><span>{check.label}{check.note ? ` — ${check.note}` : ""}</span></p>)}
                {!latest.qa_note && complianceChecks.length === 0 && <p>No automated concerns were recorded. Complete your normal visual review before publishing.</p>}
              </div>
            </Disclosure>
          )}

          <Disclosure className="mt-2" summary="Edit details" triggerClassName="px-0 text-xs font-semibold text-foreground" contentClassName="px-0">
            <div className="grid gap-3 text-xs text-muted-foreground">
              <p><span className="text-foreground">Edit order:</span> {editOrder(selectedChain)}</p>
              {fg.comment && <p><span className="text-foreground">Direction:</span> {fg.comment}</p>}
              {thread.length > 0 && <div className="grid gap-2 border-l border-border pl-3">{thread.map((message, index) => <p key={`${message.created_at}-${index}`}><span className="font-medium text-foreground">{message.role === "user" ? "You" : "Studio"}:</span> {message.content}</p>)}</div>}
            </div>
          </Disclosure>

          {isDusk && latest?.url && complianceChecks.length === 0 && (
            <Disclosure className="mt-2" summary="Dusk visual check" triggerClassName="px-0 text-xs font-semibold text-foreground" contentClassName="px-0">
              <div className="grid gap-2">{DUSK_CHECKS.map((check) => <label key={check} className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" />{check}</label>)}</div>
            </Disclosure>
          )}
          {actionError && (
            <div role="alert" className="mt-4 text-sm text-destructive">
              <p>{actionError}</p>
              {/sign-in expired/i.test(actionError) && <Link href={`/login?next=${encodeURIComponent(`/listings/${listingId}/f/${fg.id}`)}`} className="mt-2 inline-flex min-h-10 items-center font-semibold underline underline-offset-4">Sign in again</Link>}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
