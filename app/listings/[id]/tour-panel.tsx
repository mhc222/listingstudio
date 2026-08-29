"use client"

import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { TourViewer, type TourViewerHandle, type TourScene } from "@/components/tour-viewer"

export type TourRow = {
  id: string
  title: string
  slug: string
  scenes: TourScene[]
}

export function TourPanel({ listingId, tours }: { listingId: string; tours: TourRow[] }) {
  const router = useRouter()
  const [tourId, setTourId] = useState<string | null>(tours[0]?.id ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tour = tours.find((t) => t.id === tourId) ?? tours[0] ?? null

  async function createTour() {
    setBusy(true)
    setError(null)
    const res = await fetch("/api/tours", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? `request failed (${res.status})`)
      return
    }
    const data = await res.json()
    setTourId(data.tour.id)
    router.refresh()
  }

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-medium">Virtual tour</h2>
        {tours.length > 1 && (
          <select
            value={tour?.id ?? ""}
            onChange={(e) => setTourId(e.target.value)}
            className="rounded-md border bg-transparent px-2 py-1 text-sm"
          >
            {tours.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" variant="outline" onClick={createTour} disabled={busy}>
          {tours.length ? "New tour" : "Create tour"}
        </Button>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {/* Remount when the server-confirmed scene set changes (upload/save/refresh)
          so local edit state re-seeds from fresh props. */}
      {tour && (
        <TourEditor key={`${tour.id}:${tour.scenes.map((s) => s.id).join(",")}`} tour={tour} />
      )}
    </section>
  )
}

function TourEditor({ tour }: { tour: TourRow }) {
  const router = useRouter()
  const viewerRef = useRef<TourViewerHandle>(null)
  const [title, setTitle] = useState(tour.title)
  const [scenes, setScenes] = useState<TourScene[]>(tour.scenes)
  const [activeId, setActiveId] = useState<string | null>(tour.scenes[0]?.id ?? null)
  const [placing, setPlacing] = useState(false)
  const [pending, setPending] = useState<{ yaw: number; pitch: number } | null>(null)
  const [pendingTarget, setPendingTarget] = useState("")
  const [pendingLabel, setPendingLabel] = useState("")
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const active = scenes.find((s) => s.id === activeId) ?? null
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const shareUrl = `${origin}/tour/${tour.slug}`
  const embed = `<iframe src="${shareUrl}" width="800" height="450" frameborder="0" allowfullscreen></iframe>`

  const byId = useMemo(() => new Map(scenes.map((s) => [s.id, s])), [scenes])

  function patchScene(id: string, patch: Partial<TourScene>) {
    setScenes((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    setDirty(true)
  }

  function move(id: string, dir: -1 | 1) {
    setScenes((cur) => {
      const i = cur.findIndex((s) => s.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= cur.length) return cur
      const next = [...cur]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setDirty(true)
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    const form = new FormData()
    for (const f of Array.from(files)) form.append("files", f)
    const res = await fetch(`/api/tours/${tour.id}/scenes`, { method: "POST", body: form })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (data?.errors?.length) setError(data.errors.join("; "))
    router.refresh()
  }

  async function save() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/tours/${tour.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        scenes: scenes.map((s, i) => ({
          id: s.id,
          name: s.name,
          order_index: i,
          initial_yaw: s.initial_yaw,
          hotspots: s.hotspots,
        })),
        deleteSceneIds: tour.scenes.filter((s) => !byId.has(s.id)).map((s) => s.id),
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? `save failed (${res.status})`)
      return
    }
    setDirty(false)
    router.refresh()
  }

  async function deleteTour() {
    if (!confirm(`Delete "${title}" and its scenes?`)) return
    setBusy(true)
    const res = await fetch(`/api/tours/${tour.id}`, { method: "DELETE" })
    setBusy(false)
    if (!res.ok) {
      setError(`delete failed (${res.status})`)
      return
    }
    router.refresh()
  }

  function copy(text: string, which: string) {
    navigator.clipboard.writeText(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1500)
  }

  function addHotspot() {
    if (!active || !pending || !pendingTarget) return
    patchScene(active.id, {
      hotspots: [
        ...active.hotspots,
        { ...pending, target: pendingTarget, label: pendingLabel.trim().slice(0, 80) },
      ],
    })
    setPending(null)
    setPendingTarget("")
    setPendingLabel("")
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setDirty(true)
          }}
          className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-sm font-medium"
        />
        <label className="cursor-pointer rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
          {busy ? "Working…" : "Upload 360° panos"}
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              upload(e.target.files)
              e.target.value = ""
            }}
          />
        </label>
        <Button size="sm" onClick={save} disabled={!dirty || busy}>
          {dirty ? "Save changes" : "Saved"}
        </Button>
        <Button size="sm" variant="ghost" onClick={deleteTour} disabled={busy}>
          Delete
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {scenes.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Upload equirectangular (2:1) panoramas straight off a 360° camera to start.
        </p>
      ) : (
        <>
          <div className="mt-3 aspect-video w-full overflow-hidden rounded-md bg-black">
            {activeId && (
              <TourViewer
                ref={viewerRef}
                scenes={scenes}
                activeSceneId={activeId}
                onSceneChange={setActiveId}
                onPlaceHotspot={
                  placing
                    ? (yaw, pitch) => {
                        setPending({ yaw, pitch })
                        setPlacing(false)
                      }
                    : undefined
                }
              />
            )}
          </div>
          {placing && (
            <p className="mt-2 text-sm text-blue-600">
              Click a spot in the pano to place the hotspot…
            </p>
          )}
          {pending && active && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border p-2">
              <span className="text-sm">Hotspot →</span>
              <select
                value={pendingTarget}
                onChange={(e) => setPendingTarget(e.target.value)}
                className="rounded-md border bg-transparent px-2 py-1 text-sm"
              >
                <option value="">Target scene…</option>
                {scenes
                  .filter((s) => s.id !== active.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <input
                value={pendingLabel}
                onChange={(e) => setPendingLabel(e.target.value)}
                placeholder="Label (optional)"
                className="rounded-md border bg-transparent px-2 py-1 text-sm"
              />
              <Button size="sm" onClick={addHotspot} disabled={!pendingTarget}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!active || scenes.length < 2}
              onClick={() => setPlacing((p) => !p)}
            >
              {placing ? "Cancel hotspot" : "Place hotspot"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!active}
              onClick={() => {
                const yaw = viewerRef.current?.getYaw()
                if (active && yaw != null) patchScene(active.id, { initial_yaw: yaw })
              }}
            >
              Set start view
            </Button>
          </div>

          <ul className="mt-3 grid gap-1.5">
            {scenes.map((s, i) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setActiveId(s.id)}
                  className={`rounded px-1.5 py-0.5 ${
                    s.id === activeId ? "bg-blue-600 text-white" : "hover:bg-accent"
                  }`}
                >
                  {i + 1}
                </button>
                <input
                  value={s.name}
                  onChange={(e) => patchScene(s.id, { name: e.target.value })}
                  className="w-40 rounded-md border bg-transparent px-2 py-1"
                />
                <button type="button" disabled={i === 0} onClick={() => move(s.id, -1)} className="disabled:opacity-30">
                  ↑
                </button>
                <button
                  type="button"
                  disabled={i === scenes.length - 1}
                  onClick={() => move(s.id, 1)}
                  className="disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScenes((cur) => {
                      const next = cur
                        .filter((x) => x.id !== s.id)
                        .map((x) => ({
                          ...x,
                          hotspots: x.hotspots.filter((h) => h.target !== s.id),
                        }))
                      return next
                    })
                    if (activeId === s.id) setActiveId(scenes.find((x) => x.id !== s.id)?.id ?? null)
                    setDirty(true)
                  }}
                  className="text-red-600 hover:underline"
                >
                  remove
                </button>
                {s.hotspots.map((h, hi) => (
                  <span key={hi} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    → {h.label || byId.get(h.target)?.name || "?"}{" "}
                    <button
                      type="button"
                      className="text-red-600"
                      onClick={() =>
                        patchScene(s.id, { hotspots: s.hotspots.filter((_, x) => x !== hi) })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </li>
            ))}
          </ul>

          <div className="mt-3 grid gap-1.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Share:</span>
              <a href={shareUrl} target="_blank" className="truncate text-blue-600 hover:underline">
                {shareUrl}
              </a>
              <Button size="sm" variant="outline" onClick={() => copy(shareUrl, "url")}>
                {copied === "url" ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Embed:</span>
              <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">{embed}</code>
              <Button size="sm" variant="outline" onClick={() => copy(embed, "embed")}>
                {copied === "embed" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
