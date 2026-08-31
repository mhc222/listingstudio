"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { ROOM_TYPES } from "@/lib/roomTypes"
import { createRooms } from "../actions"

type Proposal = {
  name: string
  room_type: string
  length_ft: number | null
  length_in: number | null
  width_ft: number | null
  width_in: number | null
  x: number | null
  y: number | null
  units: string
  include: boolean
}

// a compact number field with a unit suffix — no browser spinner (looks cheap),
// no truncation. Value is null when empty.
function DimBox({
  value,
  onChange,
  suffix,
  w = "w-16",
}: {
  value: number | null
  onChange: (v: number | null) => void
  suffix: string
  w?: string
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        type="number"
        step="any"
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={`${w} text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      <span className="text-xs text-muted-foreground">{suffix}</span>
    </span>
  )
}

// feet + inches → decimal feet for storage (Room.length is a single numeric).
// metric ('m') keeps the value as-is in _ft.
function toDecimal(ft: number | null, inch: number | null, units: string): number | null {
  if (ft == null && inch == null) return null
  if (units === "m") return ft
  return Number(((ft ?? 0) + (inch ?? 0) / 12).toFixed(3))
}

function dimLabel(r: Proposal): string {
  if (r.units === "m") {
    if (r.length_ft == null && r.width_ft == null) return ""
    return `${r.length_ft ?? "?"} × ${r.width_ft ?? "?"} m`
  }
  const f = (ft: number | null, inch: number | null) =>
    ft == null && inch == null ? "?" : `${ft ?? 0}′${inch ? `${inch}″` : ""}`
  if (r.length_ft == null && r.length_in == null && r.width_ft == null && r.width_in == null) return ""
  return `${f(r.length_ft, r.length_in)} × ${f(r.width_ft, r.width_in)}`
}

// Floor-plan → rooms (Matt, 2026-08-31). Reads dimensions the plan prints and
// each room's position, shows a 2D overview of the plan with an editable pin per
// room, then creates the confirmed ones via the existing createRoom action.
// Human gate before any write — vision isn't 100%.
export function ExtractRooms({
  listingId,
  floorPlans,
  compact = false,
}: {
  listingId: string
  floorPlans: { id: string; url: string | null }[]
  compact?: boolean
}) {
  const router = useRouter()
  const [planId, setPlanId] = useState(floorPlans[0]?.id ?? "")
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [units, setUnits] = useState<"ft" | "m">("ft")
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const planRef = useRef<HTMLDivElement>(null)
  // drag-to-reposition a pin; distinguishes a click (select) from a drag (move)
  const dragRef = useRef<{ i: number; moved: boolean } | null>(null)

  if (floorPlans.length === 0) return null
  const planUrl = floorPlans.find((f) => f.id === planId)?.url ?? null

  async function extract() {
    if (busy) return
    setBusy(true)
    setError(null)
    setProposals(null)
    setSelected(null)
    const res = await fetch(`/api/listings/${listingId}/extract-rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ floorPlanId: planId }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? "extract failed")
      return
    }
    const rooms = (data.rooms ?? []) as Omit<Proposal, "include">[]
    if (rooms.length === 0) {
      setError("No labelled rooms found on that plan.")
      return
    }
    setUnits((data.units as string) === "m" ? "m" : "ft")
    setProposals(rooms.map((r) => ({ ...r, include: true })))
  }

  function patch(i: number, key: keyof Proposal, value: unknown) {
    setProposals((p) => p && p.map((r, j) => (j === i ? { ...r, [key]: value } : r)))
  }

  function onPinDown(e: React.PointerEvent, i: number) {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { i, moved: false }
  }
  function onPinMove(e: React.PointerEvent) {
    const d = dragRef.current
    const rect = planRef.current?.getBoundingClientRect()
    if (!d || !rect) return
    d.moved = true
    setProposals(
      (p) =>
        p &&
        p.map((r, j) =>
          j === d.i
            ? {
                ...r,
                x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
                y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
              }
            : r
        )
    )
  }
  function onPinUp(i: number) {
    const d = dragRef.current
    dragRef.current = null
    // a tap (no movement) opens the editor; a drag just repositions
    if (d && !d.moved) setSelected(i)
  }

  async function createAll() {
    if (!proposals || saving) return
    const chosen = proposals.filter((r) => r.include)
    if (chosen.length === 0) return
    setSaving(true)
    await createRooms(
      listingId,
      chosen.map((r) => ({
        name: r.name,
        room_type: r.room_type,
        length: toDecimal(r.length_ft, r.length_in, r.units),
        width: toDecimal(r.width_ft, r.width_in, r.units),
        units: r.units,
      }))
    )
    setSaving(false)
    setProposals(null)
    setSelected(null)
    router.refresh()
  }

  const includedCount = proposals?.filter((r) => r.include).length ?? 0
  const sel = selected != null && proposals ? proposals[selected] : null

  return (
    <div className={compact ? "" : "mb-3 rounded-lg border border-dashed p-3"}>
      <div className="flex flex-wrap items-center gap-2">
        {floorPlans.length > 1 && (
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)} className="w-auto text-xs">
            {floorPlans.map((f, i) => (
              <option key={f.id} value={f.id}>
                Plan {i + 1}
              </option>
            ))}
          </Select>
        )}
        <Button size="sm" variant="outline" onClick={extract} disabled={busy || !planId}>
          {busy ? "Reading plan…" : "✦ Extract rooms from floor plan"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {proposals && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true">
          {/* header */}
          <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
            <span className="font-serif text-base">Rooms from floor plan</span>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={createAll} disabled={saving || includedCount === 0}>
                {saving ? "Creating…" : `Create ${includedCount} room${includedCount === 1 ? "" : "s"}`}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setProposals(null)
                  setSelected(null)
                }}
                className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
              >
                Discard ✕
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_340px]">
            {/* 2D plan with a pin per room */}
            <div className="flex min-h-0 items-center justify-center overflow-auto bg-muted/30 p-4">
              <div ref={planRef} className="relative inline-block touch-none">
                {planUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL; next/image caching fights expiry
                  <img src={planUrl} alt="Floor plan" className="max-h-[82vh] w-auto max-w-full select-none" draggable={false} />
                )}
                {proposals.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onPointerDown={(e) => onPinDown(e, i)}
                    onPointerMove={onPinMove}
                    onPointerUp={() => onPinUp(i)}
                    style={{ left: `${(r.x ?? 0.5) * 100}%`, top: `${(r.y ?? 0.5) * 100}%` }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 max-w-[92px] cursor-grab touch-none truncate rounded-full border px-1.5 py-[2px] text-[9px] font-medium uppercase leading-none tracking-tight transition hover:z-20 hover:max-w-none active:cursor-grabbing ${
                      selected === i
                        ? "z-20 max-w-none border-primary bg-primary text-primary-foreground"
                        : r.include
                          ? "border-primary/30 bg-background/95 text-foreground hover:border-primary"
                          : "border-border bg-background/60 text-muted-foreground line-through"
                    }`}
                    title={`${r.name} · ${dimLabel(r)}`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </div>

            {/* editor / list panel */}
            <div className="min-h-0 overflow-y-auto border-t p-3 lg:border-l lg:border-t-0">
              {sel && selected != null ? (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Edit room
                    </span>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={sel.include}
                        onChange={(e) => patch(selected, "include", e.target.checked)}
                      />
                      include
                    </label>
                  </div>
                  <Input
                    value={sel.name}
                    onChange={(e) => patch(selected, "name", e.target.value)}
                    placeholder="Room name"
                  />
                  <Select
                    value={sel.room_type}
                    onChange={(e) => patch(selected, "room_type", e.target.value)}
                  >
                    {ROOM_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    {units === "m" ? (
                      <>
                        <DimBox value={sel.length_ft} onChange={(v) => patch(selected, "length_ft", v)} suffix="m" />
                        <span className="text-muted-foreground">×</span>
                        <DimBox value={sel.width_ft} onChange={(v) => patch(selected, "width_ft", v)} suffix="m" />
                      </>
                    ) : (
                      <>
                        <DimBox value={sel.length_ft} onChange={(v) => patch(selected, "length_ft", v)} suffix="ft" />
                        <DimBox value={sel.length_in} onChange={(v) => patch(selected, "length_in", v)} suffix="in" />
                        <span className="mx-0.5 text-muted-foreground">×</span>
                        <DimBox value={sel.width_ft} onChange={(v) => patch(selected, "width_ft", v)} suffix="ft" />
                        <DimBox value={sel.width_in} onChange={(v) => patch(selected, "width_in", v)} suffix="in" />
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
                  >
                    ← Back to all rooms
                  </button>
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <p className="text-xs text-muted-foreground">
                    Click a pin on the plan to edit its name and dimensions. Untick to skip a room.
                  </p>
                  {proposals.map((r, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 rounded-md border p-1.5 text-sm ${
                        r.include ? "" : "opacity-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) => patch(i, "include", e.target.checked)}
                        aria-label="include this room"
                      />
                      <button
                        type="button"
                        onClick={() => setSelected(i)}
                        className="min-w-0 flex-1 text-left hover:underline"
                      >
                        <span className="truncate font-medium">{r.name}</span>
                        <span className="ml-1 text-xs text-muted-foreground">{dimLabel(r)}</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
