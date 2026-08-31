"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { StatePill } from "@/components/brand"
import { BeforeAfter } from "@/components/before-after"
import { TourViewer } from "@/components/tour-viewer"
import type { ComplianceNote } from "../../job-panel"

const EDIT_360_TYPES = ["360_IMAGE_ENHANCEMENT", "360_ITEM_REMOVAL", "360_VIRTUAL_STAGING"]
const STAGED_TYPES = ["VIRTUAL_STAGING", "VIRTUAL_RENOVATION"]

// download menu variants ("" = the group's size preset, decided server-side)
const DOWNLOAD_VARIANTS: [string, string][] = [
  ["", "Preset default"],
  ["original", "Original photo"],
  ["full", "Full-res edited"],
  ["web1920", "Web 1920px"],
  ["under_10mb", "MLS under 10MB"],
  ["under_5mb", "MLS under 5MB"],
]

// Manual QA checklist for dusk outputs (CLAUDE.md rule 5) — only until the
// automated compliance checklist exists for the version.
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

export function FileGroupWorkspace({
  fg,
  before,
}: {
  fg: WorkspaceFileGroup
  before: BeforePhoto
}) {
  const router = useRouter()
  const [selectedVersionId, setSelectedVersionId] = useState("")
  const [reworkText, setReworkText] = useState("")
  const [reworking, setReworking] = useState(false)
  const [dlVariant, setDlVariant] = useState("")
  const [dlWatermark, setDlWatermark] = useState<boolean | null>(null)
  const [preview360, setPreview360] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [attached, setAttached] = useState(false)

  // narrow realtime channel: only this file group's own rows drive a refresh
  // (postgres_changes eq filters on the fg id / file_group_id columns)
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`fg-${fg.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "file_groups", filter: `id=eq.${fg.id}` },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "output_versions",
          filter: `file_group_id=eq.${fg.id}`,
        },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `file_group_id=eq.${fg.id}`,
        },
        () => router.refresh()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [fg.id, router])

  async function sendRework(versionId: string | undefined) {
    const message = reworkText.trim()
    if (!message || reworking) return
    setReworking(true)
    const res = await fetch(`/api/file-groups/${fg.id}/rework`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, versionId }),
    })
    setReworking(false)
    if (res.ok) {
      setReworkText("")
      setSelectedVersionId("")
    }
    router.refresh()
  }

  async function rerun() {
    await fetch(`/api/file-groups/${fg.id}/rerun`, { method: "POST" })
    router.refresh()
  }

  async function attachPlan(versionId: string | undefined) {
    if (attaching) return
    setAttaching(true)
    const res = await fetch(`/api/file-groups/${fg.id}/attach-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId }),
    })
    setAttaching(false)
    if (res.ok) setAttached(true)
    router.refresh()
  }

  const versionsDesc = [...fg.output_versions].sort((a, b) => b.version_number - a.version_number)
  const latest = versionsDesc.find((v) => v.id === selectedVersionId) ?? versionsDesc[0]
  const settled = ["complete", "failed"].includes(fg.step_status)
  const isPlan = fg.edit_chain.some((s) => s.edit_type === "FLOOR_PLAN_REDRAW")
  const isDusk = fg.edit_chain.some(
    (s) => s.edit_type === "DAY_TO_DUSK" && (s.options?.preset ?? "dusk") === "dusk"
  )
  const thread = [...(fg.chat_messages ?? [])].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  )
  // progress stripe: fills as chain steps complete (spec §05)
  const doneSteps = fg.current_step + (fg.step_status === "complete" ? 1 : 0)
  const stripeColor =
    fg.step_status === "failed"
      ? "bg-state-failed"
      : fg.step_status === "complete"
        ? "bg-state-complete"
        : "bg-state-running"

  return (
    <div>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${stripeColor}`}
          style={{
            width: `${Math.round((doneSteps / Math.max(fg.edit_chain.length, 1)) * 100)}%`,
          }}
        />
      </div>
      {thread.length > 0 && (
        <div className="mb-2 grid gap-1 rounded-md bg-muted/40 p-2">
          {thread.map((m, mi) => (
            <p key={mi} className="text-xs">
              <span className="font-medium">{m.role === "user" ? "You" : "Studio"}:</span>{" "}
              {m.content}
            </p>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <StatePill
          status={fg.step_status}
          label={`Step ${fg.current_step + 1}/${fg.edit_chain.length} · ${fg.step_status}`}
        />
      </div>
      {fg.step_status === "failed" && (
        <div className="mt-1 flex items-center gap-2">
          <p className="text-xs text-destructive">{fg.last_error}</p>
          <Button size="sm" variant="outline" onClick={rerun}>
            Re-run
          </Button>
        </div>
      )}
      {isPlan && latest?.url && (
        // plan exports (phase 11): SVG/PNG/PDF, then attach the plan back to the
        // listing to feed grounding / a 3D redraw
        <div className="mt-2">
          <BeforeAfter beforeUrl={before.url} afterUrl={latest.url} />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>v{latest.version_number}</span>
            {(["png", "svg", "pdf"] as const).map((f) => (
              <a
                key={f}
                href={`/api/file-groups/${fg.id}/plan-export?format=${f}&version=${latest.id}`}
                className="uppercase underline hover:text-foreground"
              >
                {f}
              </a>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => attachPlan(latest.id)}
              disabled={attaching || attached}
            >
              {attached ? "Attached ✓" : attaching ? "Attaching…" : "Attach as floor plan"}
            </Button>
          </div>
        </div>
      )}
      {!isPlan && latest?.url && (() => {
        const staged = fg.edit_chain.some((s) => STAGED_TYPES.includes(s.edit_type))
        const is360 = fg.edit_chain.some((s) => EDIT_360_TYPES.includes(s.edit_type))
        const wm = dlWatermark ?? staged
        const variant = dlVariant
        const href =
          `/api/file-groups/${fg.id}/download?version=${latest.id}` +
          `&watermark=${wm ? 1 : 0}` +
          (variant ? `&variant=${variant}` : "")
        return (
          <div className="mt-2">
            {is360 && preview360 ? (
              // Marzipano preview of the edited pano (phase 17) — the fastest way
              // to eyeball the seam and poles
              <div className="h-80 w-full overflow-hidden rounded-md bg-black">
                <TourViewer
                  scenes={[
                    {
                      id: fg.id,
                      name: "360 preview",
                      url: latest.url,
                      width: before.width ?? 4096,
                      initial_yaw: 0,
                      hotspots: [],
                    },
                  ]}
                  activeSceneId={fg.id}
                />
              </div>
            ) : (
              <BeforeAfter beforeUrl={before.url} afterUrl={latest.url} />
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>v{latest.version_number}</span>
              {is360 && (
                <button
                  type="button"
                  onClick={() => setPreview360((s) => !s)}
                  className="underline hover:text-foreground"
                >
                  {preview360 ? "Before/after" : "Preview in 360"}
                </button>
              )}
              <select
                value={variant}
                onChange={(e) => setDlVariant(e.target.value)}
                className="rounded-md border bg-transparent px-1.5 py-0.5 text-xs"
              >
                {DOWNLOAD_VARIANTS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              {variant !== "original" && (
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={wm}
                    onChange={(e) => setDlWatermark(e.target.checked)}
                  />
                  “Virtually Staged” label
                </label>
              )}
              <a href={href} className="underline hover:text-foreground">
                Download
              </a>
            </div>
          </div>
        )
      })()}
      {latest?.qa_note && (
        <p className="mt-1 text-xs text-muted-foreground">QA: {latest.qa_note}</p>
      )}
      {(latest?.compliance?.checks?.length ?? 0) > 0 && (
        <div className="mt-2 rounded-md border p-2">
          <p className="text-xs font-medium uppercase tracking-wide">MLS compliance</p>
          {latest!.compliance!.checks!.map((c) => (
            <p
              key={c.id}
              className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground"
            >
              <span className={c.pass ? "text-state-complete" : "font-bold text-state-failed"}>
                {c.pass ? "✓" : "✕"}
              </span>
              <span>
                {c.label}
                {c.note ? ` — ${c.note}` : ""}
              </span>
            </p>
          ))}
        </div>
      )}
      {versionsDesc.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">Versions:</span>
          {[...versionsDesc].reverse().map((v) => (
            <button
              key={v.id}
              type="button"
              title={v.parent_version_id ? "branched" : undefined}
              onClick={() => setSelectedVersionId(v.id)}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                latest?.id === v.id ? "border-primary font-medium" : "hover:bg-muted"
              }`}
            >
              v{v.version_number}
            </button>
          ))}
        </div>
      )}
      {settled && versionsDesc.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={reworkText}
            onChange={(e) => setReworkText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendRework(latest?.id)}
            placeholder={`React to v${latest?.version_number} to rework it, e.g. couch in gray, lose the wall art`}
            className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => sendRework(latest?.id)}
            disabled={!reworkText.trim() || reworking}
          >
            {reworking ? "Reworking…" : "Rework"}
          </Button>
        </div>
      )}
      {/* manual dusk checkboxes (phase 6) stand in only until the automated
          compliance checklist exists for the version */}
      {isDusk && latest?.url && !latest?.compliance?.checks?.length && (
        <div className="mt-2 rounded-md border p-2">
          <p className="text-xs font-medium">Dusk checks (manual)</p>
          {DUSK_CHECKS.map((check) => (
            <label key={check} className="mt-1 flex items-center gap-1.5 text-xs">
              <input type="checkbox" />
              {check}
            </label>
          ))}
          <p className="mt-1 text-xs text-muted-foreground">
            If either fails, re-run with a corrective note.
          </p>
        </div>
      )}
    </div>
  )
}
