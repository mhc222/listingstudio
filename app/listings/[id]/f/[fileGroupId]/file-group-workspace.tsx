"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { StatePill } from "@/components/brand"
import { BeforeAfter } from "@/components/before-after"
import { TourViewer } from "@/components/tour-viewer"
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
    version_number: number
    parent_version_id: string | null
    qa_note: string | null
    compliance: ComplianceNote
    url: string | null
  }[]
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

export function FileGroupWorkspace({ listingId, fg, before, siblings }: {
  listingId: string
  fg: WorkspaceFileGroup
  before: BeforePhoto
  siblings: Sibling[]
}) {
  const router = useRouter()
  const [selectedVersionId, setSelectedVersionId] = useState("")
  const [reworkText, setReworkText] = useState("")
  const [reworking, setReworking] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dlVariant, setDlVariant] = useState("")
  const [dlWatermark, setDlWatermark] = useState<boolean | null>(null)
  const [preview360, setPreview360] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [attached, setAttached] = useState(false)

  const versionsDesc = [...fg.output_versions].sort((a, b) => b.version_number - a.version_number)
  const latest = versionsDesc.find((version) => version.id === selectedVersionId) ?? versionsDesc[0]
  const settled = ["complete", "failed"].includes(fg.step_status)
  const isPlan = fg.edit_chain.some((step) => step.edit_type === "FLOOR_PLAN_REDRAW")
  const isDusk = fg.edit_chain.some(
    (step) => step.edit_type === "DAY_TO_DUSK" && (step.options?.preset ?? "dusk") === "dusk"
  )
  const is360 = fg.edit_chain.some((step) => EDIT_360_TYPES.includes(step.edit_type))
  const staged = fg.edit_chain.some((step) => STAGED_TYPES.includes(step.edit_type))
  const thread = [...(fg.chat_messages ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const copy = statusCopy(fg.step_status, Boolean(latest?.url))
  const selectedSiblingIndex = Math.max(0, siblings.findIndex((item) => item.id === fg.id))

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`fg-${fg.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "file_groups", filter: `id=eq.${fg.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "output_versions", filter: `file_group_id=eq.${fg.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `file_group_id=eq.${fg.id}` }, () => router.refresh())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fg.id, router])

  // localhost cannot receive fal webhooks. This listing-scoped endpoint uses
  // the same orchestrator transitions and production realtime remains primary.
  useEffect(() => {
    if (settled) return
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
  }, [listingId, router, settled])

  async function sendRework(versionId: string | undefined) {
    const message = reworkText.trim()
    if (!message || reworking) return
    setReworking(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/file-groups/${fg.id}/rework`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, versionId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setActionError(data?.error ?? "The refinement could not be started. Try again.")
        return
      }
      setReworkText("")
      setSelectedVersionId("")
      router.refresh()
    } catch {
      setActionError("The connection was interrupted. Your refinement is still here—try again.")
    } finally {
      setReworking(false)
    }
  }

  async function rerun() {
    setActionError(null)
    try {
      const response = await fetch(`/api/file-groups/${fg.id}/rerun`, { method: "POST" })
      if (!response.ok) setActionError("This edit could not be restarted. Try again from Activity.")
      router.refresh()
    } catch {
      setActionError("The connection was interrupted. Try again.")
    }
  }

  async function attachPlan(versionId: string | undefined) {
    if (attaching) return
    setAttaching(true)
    const response = await fetch(`/api/file-groups/${fg.id}/attach-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId }),
    }).catch(() => null)
    setAttaching(false)
    if (response?.ok) setAttached(true)
    else setActionError("The plan could not be attached. Try again.")
    router.refresh()
  }

  const watermark = dlWatermark ?? staged
  const downloadHref = latest
    ? `/api/file-groups/${fg.id}/download?version=${latest.id}&watermark=${watermark ? 1 : 0}${dlVariant ? `&variant=${dlVariant}` : ""}`
    : "#"
  const complianceChecks = latest?.compliance?.checks ?? []
  const qaNeedsReview = Boolean(latest?.qa_note) || complianceChecks.some((check) => !check.pass)

  return (
    <div>
      {siblings.length > 1 && (
        <nav aria-label="Photos in this edit" className="mb-4 flex items-center gap-3 overflow-x-auto border-b border-border pb-4">
          <p className="shrink-0 font-ui text-xs uppercase tracking-[0.12em] text-muted-foreground">Photo {selectedSiblingIndex + 1} of {siblings.length}</p>
          <div className="flex gap-2">
            {siblings.map((sibling, index) => (
              <Link key={sibling.id} href={`/listings/${listingId}/f/${sibling.id}`} aria-current={sibling.id === fg.id ? "page" : undefined}
                className={`relative block h-12 w-16 shrink-0 overflow-hidden border-2 ${sibling.id === fg.id ? "border-primary" : "border-transparent ring-1 ring-border"}`}
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

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="Photo result" className="min-w-0">
          {latest?.url ? (
            is360 && preview360 ? (
              <div className="h-[62vh] min-h-96 w-full overflow-hidden bg-black">
                <TourViewer scenes={[{ id: fg.id, name: "360 result", url: latest.url, width: before.width ?? 4096, initial_yaw: 0, hotspots: [] }]} activeSceneId={fg.id} />
              </div>
            ) : <BeforeAfter beforeUrl={before.url} afterUrl={latest.url} />
          ) : (
            <div className="sweep relative flex min-h-[56vh] items-center justify-center overflow-hidden bg-[#241f1a] p-5 sm:p-10">
              {before.url && (
                // eslint-disable-next-line @next/next/no-img-element -- signed listing-photo URL
                <img src={before.url} alt="Original photo" className="max-h-[70vh] w-full object-contain opacity-75" />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-6 pb-6 pt-20 text-white">
                <p className="font-serif text-2xl">{copy.heading}</p>
                <p className="mt-1 text-sm text-white/75">You can leave this page. The edit will keep running.</p>
              </div>
            </div>
          )}
          {!settled && latest?.url && (
            <div className="mt-3 border-l-2 border-state-running pl-3">
              <p className="font-medium">{copy.heading}</p>
              <p className="text-sm text-muted-foreground">The result above remains available while the new version develops.</p>
            </div>
          )}
        </section>

        <aside className="border-t border-border pt-5 lg:sticky lg:top-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <StatePill status={fg.step_status} label={copy.label} />
          <h2 className="mt-2 font-serif text-2xl">{copy.heading}</h2>

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
            <section className="mt-5 border-t border-border pt-4">
              <h3 className="font-ui text-xs font-semibold uppercase tracking-[0.12em]">Download</h3>
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

          {latest?.url && isPlan && (
            <section className="mt-5 border-t border-border pt-4">
              <h3 className="font-ui text-xs font-semibold uppercase tracking-[0.12em]">Export plan</h3>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["png", "svg", "pdf"] as const).map((format) => <Button key={format} asChild size="sm" variant="outline"><a href={`/api/file-groups/${fg.id}/plan-export?format=${format}&version=${latest.id}`}>{format.toUpperCase()}</a></Button>)}
              </div>
              <Button className="mt-3 w-full" variant="outline" onClick={() => attachPlan(latest.id)} disabled={attaching || attached}>{attached ? "Attached to listing ✓" : attaching ? "Attaching…" : "Attach to listing"}</Button>
            </section>
          )}

          {latest?.url && settled && (
            <section className="mt-5 border-t border-border pt-4">
              <label htmlFor="refine-result" className="font-ui text-xs font-semibold uppercase tracking-[0.12em]">Refine this version</label>
              <p className="mt-1 text-xs text-muted-foreground">A refinement creates a new version. This one stays safe.</p>
              <textarea id="refine-result" value={reworkText} onChange={(event) => setReworkText(event.target.value)} placeholder="What should change? e.g. use a gray sofa and remove the wall art" rows={3}
                className="mt-2 w-full resize-none border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
              <Button className="mt-2 w-full" variant="outline" onClick={() => sendRework(latest.id)} disabled={!reworkText.trim() || reworking}>{reworking ? "Creating version…" : "Create new version"}</Button>
            </section>
          )}

          {versionsDesc.length > 0 && (
            <section className="mt-5 border-t border-border pt-4">
              <h3 className="font-ui text-xs font-semibold uppercase tracking-[0.12em]">Versions</h3>
              <div className="mt-2 grid gap-1">
                {[...versionsDesc].reverse().map((version, index) => (
                  <button key={version.id} type="button" onClick={() => setSelectedVersionId(version.id)}
                    className={`flex min-h-10 items-center justify-between border-b px-1 text-left text-sm ${latest?.id === version.id ? "border-primary font-medium" : "border-border text-muted-foreground hover:text-foreground"}`}>
                    <span>{index === 0 ? "Original edit" : `Revision ${index}`}</span><span className="text-xs">v{version.version_number}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {latest?.url && (
            <details className="mt-5 border-t border-border pt-4">
              <summary className="cursor-pointer font-ui text-xs font-semibold uppercase tracking-[0.12em]">{qaNeedsReview ? "Review recommended" : "Ready for MLS"}</summary>
              <div className="mt-3 text-xs text-muted-foreground">
                {latest.qa_note && <p>{latest.qa_note}</p>}
                {complianceChecks.map((check) => <p key={check.id} className="mt-2 flex items-start gap-2"><span className={check.pass ? "text-state-complete" : "text-state-failed"}>{check.pass ? "✓" : "✕"}</span><span>{check.label}{check.note ? ` — ${check.note}` : ""}</span></p>)}
                {!latest.qa_note && complianceChecks.length === 0 && <p>No automated concerns were recorded. Complete your normal visual review before publishing.</p>}
              </div>
            </details>
          )}

          <details className="mt-5 border-t border-border pt-4">
            <summary className="cursor-pointer font-ui text-xs font-semibold uppercase tracking-[0.12em]">Edit details</summary>
            <div className="mt-3 grid gap-3 text-xs text-muted-foreground">
              <p><span className="text-foreground">Edit order:</span> {editOrder(fg.edit_chain)}</p>
              {fg.comment && <p><span className="text-foreground">Direction:</span> {fg.comment}</p>}
              {thread.length > 0 && <div className="grid gap-2 border-l border-border pl-3">{thread.map((message, index) => <p key={`${message.created_at}-${index}`}><span className="font-medium text-foreground">{message.role === "user" ? "You" : "Studio"}:</span> {message.content}</p>)}</div>}
            </div>
          </details>

          {isDusk && latest?.url && complianceChecks.length === 0 && (
            <details className="mt-5 border-t border-border pt-4">
              <summary className="cursor-pointer font-ui text-xs font-semibold uppercase tracking-[0.12em]">Dusk visual check</summary>
              <div className="mt-3 grid gap-2">{DUSK_CHECKS.map((check) => <label key={check} className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" />{check}</label>)}</div>
            </details>
          )}
          {actionError && <p role="alert" className="mt-4 text-sm text-destructive">{actionError}</p>}
        </aside>
      </div>
    </div>
  )
}
