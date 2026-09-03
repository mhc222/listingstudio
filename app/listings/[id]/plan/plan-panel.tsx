"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { PLAN_STYLES, PLAN_DISCLAIMER } from "@/lib/prompts"
import { MODELS, AVG_GENERATIONS_PER_FILE_GROUP } from "@/config/models"
import type { PhotoRow } from "../photo-grid"

// Floor plan redraw controls (phase 11). Input is always an image floor
// plan/sketch — room photos never appear here (CLAUDE.md). For the 3D
// variant: attach a finished 2D plan, then redraw it in 3D Isometric.
export function PlanPanel({ listingId, plans }: { listingId: string; plans: PhotoRow[] }) {
  const router = useRouter()
  const [planId, setPlanId] = useState<string | null>(null)
  const [style, setStyle] = useState("2d_colour")
  const [units, setUnits] = useState("sqft")
  const [furniture, setFurniture] = useState(true)
  const [northArrow, setNorthArrow] = useState(true)
  const [addressLabel, setAddressLabel] = useState(true)
  const [disclaimer, setDisclaimer] = useState(PLAN_DISCLAIMER)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRequestId = useRef<string | null>(null)

  if (plans.length === 0) return null

  async function run() {
    if (!planId || running) return
    setRunning(true)
    setError(null)
    pendingRequestId.current ??= crypto.randomUUID()
    let res: Response
    try {
      res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          photoId: planId,
          targetRequestId: pendingRequestId.current,
          selectionMethod: "single",
          editChain: [
            {
              edit_type: "FLOOR_PLAN_REDRAW",
              options: {
                style,
                units,
                furniture,
                north_arrow: northArrow,
                address_label: addressLabel,
                disclaimer: disclaimer.trim(),
              },
            },
          ],
        }),
      })
      pendingRequestId.current = null
    } catch {
      setRunning(false)
      setError("The connection was interrupted. Try again; the same request will be reused safely.")
      return
    }
    setRunning(false)
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? `request failed (${res.status})`)
      return
    }
    setPlanId(null)
    router.refresh()
  }

  return (
    <div className="mt-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Redraw a floor plan</p>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
        {plans.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPlanId((cur) => (cur === p.id ? null : p.id))}
            className={`shrink-0 overflow-hidden rounded-md border-2 ${
              planId === p.id ? "border-primary" : "border-transparent"
            }`}
          >
            {p.url && (
              // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
              <img src={p.thumb_url ?? p.url} alt="" loading="lazy" decoding="async" width={480} height={360} className="h-16 w-24 object-cover" />
            )}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          className="w-auto"
        >
          {Object.entries(PLAN_STYLES).map(([k, { label }]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          value={units}
          onChange={(e) => setUnits(e.target.value)}
          className="w-auto"
        >
          <option value="sqft">sq ft</option>
          <option value="sqm">sq m</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={furniture}
            onChange={(e) => setFurniture(e.target.checked)}
          />
          Furniture
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={northArrow}
            onChange={(e) => setNorthArrow(e.target.checked)}
          />
          North arrow
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={addressLabel}
            onChange={(e) => setAddressLabel(e.target.checked)}
          />
          Address label
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={disclaimer}
          onChange={(e) => setDisclaimer(e.target.value)}
          placeholder="Disclaimer text (blank for none)"
          className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-sm"
        />
        <Button size="sm" onClick={run} disabled={!planId || running}>
          {running ? "Submitting…" : "Redraw"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        ~{Math.round(AVG_GENERATIONS_PER_FILE_GROUP)} generations · {MODELS.gemini.label}. For 3D:
        redraw in 2D first, attach the result as a floor plan, then redraw the attached plan in 3D
        Isometric.
      </p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
