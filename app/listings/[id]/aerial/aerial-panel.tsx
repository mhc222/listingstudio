"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import type { PhotoRow } from "../photo-grid"

// Konva touches window at import time — client-only
const AerialAnnotator = dynamic(
  () => import("@/components/aerial-annotator").then((m) => m.AerialAnnotator),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading annotator…</p> }
)

export function AerialPanel({ listingId, photos }: { listingId: string; photos: PhotoRow[] }) {
  const router = useRouter()
  const [photoId, setPhotoId] = useState<string | null>(null)
  const selected = photos.find((p) => p.id === photoId)

  async function saveToListing(blob: Blob) {
    const form = new FormData()
    form.set("listingId", listingId)
    form.set("isFloorPlan", "false")
    form.append("files", new File([blob], "aerial-annotated.png", { type: "image/png" }))
    const res = await fetch("/api/upload", { method: "POST", body: form })
    const json = await res.json()
    if (!res.ok || !json.uploaded?.length) throw new Error(json.errors?.[0] ?? "upload failed")
    router.refresh()
  }

  if (!photos.length) return null

  return (
    <section>
      <h2 className="mb-3 text-lg font-medium">Annotate aerial</h2>
      <p className="mb-2 text-sm text-muted-foreground">
        Pick a drone shot, then highlight the lot, draw boundary lines, and drop labeled pins.
      </p>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {photos.map((p) => (
          <button
            key={p.id}
            onClick={() => setPhotoId(photoId === p.id ? null : p.id)}
            className={`h-16 w-24 shrink-0 overflow-hidden rounded-md border-2 ${
              photoId === p.id ? "border-primary" : "border-transparent"
            }`}
            title={photoId === p.id ? "Close annotator" : "Annotate this photo"}
          >
            {/* signed URLs expire — plain img, per photo-grid precedent */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.url && <img src={p.url} alt="" className="h-full w-full object-cover" />}
          </button>
        ))}
      </div>
      {selected?.url && (
        <AerialAnnotator key={selected.id} src={selected.url} onSave={saveToListing} />
      )}
    </section>
  )
}
