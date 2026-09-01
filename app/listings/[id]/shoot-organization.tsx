"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, Plus, RotateCcw, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Disclosure } from "@/components/ui/disclosure"
import { Select } from "@/components/ui/select"
import { type PhotoRow } from "./photo-grid"

export type PhotoGroupRow = {
  id: string
  state: "proposed" | "confirmed"
  confidence: number
  reason: string
  representative_photo_id: string | null
  memberPhotoIds: string[]
  created_at: string
}

function exposureLabel(photo: PhotoRow) {
  const parts: string[] = []
  if (photo.exposure_bias_ev != null) parts.push(`${photo.exposure_bias_ev > 0 ? "+" : ""}${photo.exposure_bias_ev.toFixed(1)} EV`)
  if (photo.exposure_time_seconds) {
    parts.push(photo.exposure_time_seconds < 1 ? `1/${Math.round(1 / photo.exposure_time_seconds)}s` : `${photo.exposure_time_seconds.toFixed(1)}s`)
  }
  if (photo.aperture_f_number) parts.push(`f/${photo.aperture_f_number.toFixed(1)}`)
  if (photo.iso) parts.push(`ISO ${photo.iso}`)
  return parts.join(" · ") || "Exposure metadata unavailable"
}

async function responseJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(body.error || "The organization change could not be saved.")
  return body
}

export function ShootOrganization({
  listingId,
  photos,
  logicalPhotoCount,
  floorPlanCount,
  groups,
}: {
  listingId: string
  photos: PhotoRow[]
  logicalPhotoCount: number
  floorPlanCount: number
  groups: PhotoGroupRow[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string[]>>({})
  const [manual, setManual] = useState<string[]>([])
  const byId = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos])
  const grouped = new Set(groups.flatMap((group) => group.memberPhotoIds))
  const sourcePhotos = photos.filter((photo) => photo.photo_role !== "hdr_merged")
  const ungrouped = sourcePhotos.filter((photo) => !grouped.has(photo.id))
  const proposed = groups.filter((group) => group.state === "proposed")
  const confirmed = groups.filter((group) => group.state === "confirmed")
  const mergedCount = confirmed.filter((group) => group.representative_photo_id).length
  const reviewExposureCount = proposed.reduce((total, group) => total + group.memberPhotoIds.length, 0)

  async function act(key: string, request: () => Promise<Response>) {
    setBusy(key)
    setError(null)
    try {
      await responseJson(await request())
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The organization change could not be saved.")
    } finally {
      setBusy(null)
    }
  }

  async function detect() {
    await act("detect", () => fetch(`/api/listings/${listingId}/photo-groups/detect`, { method: "POST" }))
  }

  function draftFor(group: PhotoGroupRow) {
    return drafts[group.id] ?? group.memberPhotoIds
  }

  function setDraft(groupId: string, memberPhotoIds: string[]) {
    setDrafts((current) => ({ ...current, [groupId]: memberPhotoIds }))
  }

  function move(group: PhotoGroupRow, index: number, delta: number) {
    const next = [...draftFor(group)]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setDraft(group.id, next)
  }

  async function save(group: PhotoGroupRow) {
    const photoIds = draftFor(group)
    await act(`save-${group.id}`, () => fetch(`/api/listings/${listingId}/photo-groups/${group.id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ photoIds }),
    }))
  }

  return (
    <section id="shoot-organization" className="ls-surface scroll-mt-24 overflow-hidden" aria-labelledby="shoot-inventory-title">
      <div className="flex flex-col gap-3 border-b border-border/65 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="shoot-inventory-title" className="text-lg font-semibold tracking-[-0.02em]">Shoot inventory</h2>
          <p className="mt-1 text-sm text-muted-foreground">Source exposures stay intact. Confirmed HDR stacks become one editable photo.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={detect} disabled={busy !== null || sourcePhotos.length < 3}>
          <Sparkles aria-hidden="true" />{busy === "detect" ? "Checking…" : "Find HDR brackets"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-px bg-border/55 sm:grid-cols-3 lg:grid-cols-6">
        {[
          [sourcePhotos.length, "Source photos"], [logicalPhotoCount, "Photos ready"], [floorPlanCount, "Floor plans"],
          [proposed.length, "Proposed stacks"], [confirmed.length, "Confirmed stacks"], [mergedCount, "Merged results"],
        ].map(([value, label]) => (
          <div key={label} className="bg-card/80 px-3 py-3">
            <div className="font-ui text-xl font-semibold tabular-nums">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <Disclosure
        summary={
          <span className="flex items-center justify-between gap-3">
            <span>HDR organization</span>
            <span className="text-xs font-normal text-muted-foreground">{reviewExposureCount ? `${reviewExposureCount} exposures need review` : "No pending bracket review"}</span>
          </span>
        }
        defaultOpen={proposed.length > 0}
        className="p-2"
        contentClassName="grid gap-4"
      >
        {error && <p role="alert" className="rounded-lg bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>}
        {groups.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No bracket stacks yet. Detection uses capture timing, frame dimensions, camera/lens data, and exposure settings. Uncertain matches stay visible for review.</p>
        ) : (
          groups.map((group) => {
            const memberIds = draftFor(group)
            const changed = memberIds.join(",") !== group.memberPhotoIds.join(",")
            const available = ungrouped.filter((photo) => !memberIds.includes(photo.id))
            const manuallyReviewed = group.reason.startsWith("Created manually") || group.reason.startsWith("Adjusted manually")
            return (
              <article key={group.id} className="rounded-xl border border-border/70 bg-card/60 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{group.state === "confirmed" ? "Confirmed HDR stack" : "Proposed HDR stack"}</span>
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[0.68rem] font-semibold text-accent-foreground">
                        {manuallyReviewed ? "Manual" : `${Math.round(group.confidence * 100)}% ${group.confidence >= 0.8 ? "match" : "— review"}`}
                      </span>
                    </div>
                    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{group.reason}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.state === "proposed" ? (
                      <>
                        <Button size="sm" onClick={() => act(`confirm-${group.id}`, () => fetch("/api/hdr-merge", {
                          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listingId, groupId: group.id }),
                        }))} disabled={busy !== null || changed}>
                          {busy === `confirm-${group.id}` ? "Merging…" : "Confirm & merge"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => act(`dismiss-${group.id}`, () => fetch(`/api/listings/${listingId}/photo-groups/${group.id}`, {
                          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss" }),
                        }))} disabled={busy !== null}>Keep separate</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => act(`reopen-${group.id}`, () => fetch(`/api/listings/${listingId}/photo-groups/${group.id}`, {
                        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reopen" }),
                      }))} disabled={busy !== null}><RotateCcw aria-hidden="true" />Reopen stack</Button>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {memberIds.map((photoId, index) => {
                    const photo = byId.get(photoId)
                    if (!photo) return null
                    return (
                      <div key={photoId} className="flex min-w-0 items-center gap-2 rounded-lg bg-background/75 p-2">
                        {photo.url && (
                          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URL
                          <img src={photo.url} alt="" className="h-14 w-16 shrink-0 rounded-md object-cover" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">{photo.original_filename || `Exposure ${index + 1}`}</div>
                          <div className="truncate text-[0.68rem] text-muted-foreground">{exposureLabel(photo)}</div>
                        </div>
                        {group.state === "proposed" && (
                          <div className="grid grid-cols-2 gap-0.5">
                            <Button type="button" size="icon-xs" variant="ghost" aria-label="Move exposure earlier" onClick={() => move(group, index, -1)} disabled={index === 0 || busy !== null}><ArrowLeft /></Button>
                            <Button type="button" size="icon-xs" variant="ghost" aria-label="Move exposure later" onClick={() => move(group, index, 1)} disabled={index === memberIds.length - 1 || busy !== null}><ArrowRight /></Button>
                            <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove exposure from stack" className="col-span-2" onClick={() => setDraft(group.id, memberIds.filter((id) => id !== photoId))} disabled={memberIds.length <= 3 || busy !== null}><X /></Button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {group.state === "proposed" && (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    {available.length > 0 && memberIds.length < 9 && (
                      <Select className="h-9 max-w-sm text-xs" value="" onChange={(event) => {
                        if (event.target.value) setDraft(group.id, [...memberIds, event.target.value])
                      }} aria-label="Add an ungrouped exposure">
                        <option value="">Add missed exposure…</option>
                        {available.map((photo) => <option key={photo.id} value={photo.id}>{photo.original_filename || photo.id.slice(0, 8)}</option>)}
                      </Select>
                    )}
                    {changed && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => save(group)} disabled={busy !== null || memberIds.length < 3}>Save members & order</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDrafts((current) => { const next = { ...current }; delete next[group.id]; return next })}>Discard changes</Button>
                      </>
                    )}
                  </div>
                )}
              </article>
            )
          })
        )}

        {ungrouped.length >= 3 && (
          <div className="border-t border-border/65 pt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-medium">Create a missed stack</h3>
                <p className="text-xs text-muted-foreground">Choose 3–9 ungrouped source exposures in merge order.</p>
              </div>
              <Button size="sm" variant="outline" disabled={manual.length < 3 || manual.length > 9 || busy !== null} onClick={() => act("manual", () => fetch(`/api/listings/${listingId}/photo-groups`, {
                method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photoIds: manual }),
              }))}><Plus aria-hidden="true" />Create stack ({manual.length})</Button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ungrouped.map((photo) => (
                <label key={photo.id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg bg-background/70 p-2 text-xs">
                  <input type="checkbox" checked={manual.includes(photo.id)} onChange={() => setManual((current) => current.includes(photo.id) ? current.filter((id) => id !== photo.id) : current.length < 9 ? [...current, photo.id] : current)} />
                  {photo.url && (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URL
                    <img src={photo.url} alt="" className="h-10 w-12 rounded object-cover" />
                  )}
                  <span className="truncate">{photo.original_filename || photo.id.slice(0, 8)}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </Disclosure>
    </section>
  )
}
