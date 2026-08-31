"use client"

import { useState } from "react"
import { PhotoGrid, type PhotoRow } from "./photo-grid"
import { JobPanel, type JobRow, type SampleRow } from "./job-panel"

type Room = { id: string; name: string }

// Phase 29: one selection surface (the grid) feeds the composer. This wrapper
// owns selectedIds so the tray header and JobPanel stay in sync — no context,
// there is exactly one consumer.
export function ListingWorkspace({
  listingId,
  photos,
  floorPlans,
  rooms,
  jobs,
  samples,
}: {
  listingId: string
  photos: PhotoRow[]
  floorPlans: PhotoRow[]
  rooms: Room[]
  jobs: JobRow[]
  samples: SampleRow[]
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // anchor index for shift-click range select
  const [anchor, setAnchor] = useState<number | null>(null)

  function selectPhoto(index: number, shift: boolean) {
    if (shift && anchor !== null) {
      const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor]
      const range = photos.slice(lo, hi + 1).map((p) => p.id)
      setSelectedIds((prev) => Array.from(new Set([...prev, ...range])))
      return
    }
    const id = photos[index].id
    setAnchor(index)
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function clear() {
    setSelectedIds([])
    setAnchor(null)
  }

  return (
    <div className="grid gap-8">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Photos ({photos.length})</h2>
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-primary bg-accent px-2 py-0.5 font-ui uppercase tracking-wide text-accent-foreground">
                {selectedIds.length} selected ·{" "}
                {selectedIds.length === 1 ? "chat & markup" : "batch"}
              </span>
              <button type="button" onClick={clear} className="underline hover:text-foreground">
                Clear
              </button>
            </div>
          )}
        </div>
        <PhotoGrid
          photos={photos}
          rooms={rooms}
          listingId={listingId}
          selectedIds={selectedIds}
          onSelect={selectPhoto}
        />
      </section>
      <JobPanel
        listingId={listingId}
        photos={photos}
        floorPlans={floorPlans}
        jobs={jobs}
        samples={samples}
        selectedIds={selectedIds}
        onClearSelection={clear}
      />
    </div>
  )
}
