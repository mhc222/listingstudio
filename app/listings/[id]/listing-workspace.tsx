"use client"

import { useEffect, useState } from "react"
import { PhotoGrid, type PhotoRow } from "./photo-grid"
import { Composer } from "./composer"
import { JobFeed, type JobRow, type SampleRow } from "./job-feed"
import {
  ALL_ROOMS,
  RoomBrowser,
  UNTAGGED_ROOM,
  roomDisplayLabels,
  type RoomRow,
} from "./room-browser"

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
  rooms: RoomRow[]
  jobs: JobRow[]
  samples: SampleRow[]
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeRoom, setActiveRoom] = useState(ALL_ROOMS)
  // anchor index for shift-click range select
  const [anchor, setAnchor] = useState<number | null>(null)
  // full-screen single-photo editor (Matt, 2026-08-31): clicking a photo opens
  // it large with the Composer scoped to that one photo; the grid keeps the
  // corner-checkbox batch path. Esc closes.
  const [openId, setOpenId] = useState<string | null>(null)
  const openPhoto = photos.find((p) => p.id === openId) ?? null
  const filteredPhotos =
    activeRoom === ALL_ROOMS
      ? photos
      : activeRoom === UNTAGGED_ROOM
        ? photos.filter((photo) => photo.room_id == null)
        : photos.filter((photo) => photo.room_id === activeRoom)
  const roomLabels = roomDisplayLabels(rooms)
  const roomOptions = rooms.map((room) => ({
    id: room.id,
    name: roomLabels.get(room.id) ?? room.name,
  }))

  useEffect(() => {
    if (
      activeRoom !== ALL_ROOMS &&
      activeRoom !== UNTAGGED_ROOM &&
      !rooms.some((room) => room.id === activeRoom)
    ) {
      setActiveRoom(ALL_ROOMS)
      setSelectedIds([])
      setAnchor(null)
    }
  }, [activeRoom, rooms])
  useEffect(() => {
    if (!openId) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [openId])

  // phase 31: newest job's batchable chain — feeds the composer's "apply last
  // chain" accelerator. Skip ideas jobs; strip REWORK (internal) and MARKUP_EDIT
  // (arity-1, bound to a one-off drawn image) — neither replays across a batch.
  const lastChain = (() => {
    for (const j of jobs) {
      if (j.kind === "ideas") continue
      const steps = (j.file_groups[0]?.edit_chain ?? []).filter(
        (s) => s.edit_type !== "REWORK" && s.edit_type !== "MARKUP_EDIT"
      )
      if (steps.length) return steps
    }
    return null
  })()

  function selectPhoto(index: number, shift: boolean) {
    if (shift && anchor !== null) {
      const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor]
      const range = filteredPhotos.slice(lo, hi + 1).map((p) => p.id)
      setSelectedIds((prev) => Array.from(new Set([...prev, ...range])))
      return
    }
    const id = filteredPhotos[index].id
    setAnchor(index)
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function clear() {
    setSelectedIds([])
    setAnchor(null)
  }

  function changeRoomFilter(value: string) {
    setActiveRoom(value)
    clear()
  }

  return (
    <div className="grid gap-8">
      <RoomBrowser
        listingId={listingId}
        rooms={rooms}
        photos={photos}
        floorPlans={floorPlans.map((plan) => ({ id: plan.id, url: plan.url }))}
        activeRoom={activeRoom}
        onActiveRoomChange={changeRoomFilter}
      />
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">
            Photos ({filteredPhotos.length}
            {activeRoom !== ALL_ROOMS ? ` of ${photos.length}` : ""})
          </h2>
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
          photos={filteredPhotos}
          rooms={roomOptions}
          listingId={listingId}
          selectedIds={selectedIds}
          onSelect={selectPhoto}
          onOpen={(i) => setOpenId(filteredPhotos[i].id)}
        />
        {filteredPhotos.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Click a photo to edit it full-screen · use the corner ＋ to batch-select several.
          </p>
        )}
      </section>
      {/* inline composer drives BATCH runs (2+ photos checkbox-selected) */}
      <Composer
        listingId={listingId}
        photos={photos}
        samples={samples}
        selectedIds={selectedIds}
        onClearSelection={clear}
        lastChain={lastChain}
      />
      <JobFeed listingId={listingId} photos={photos} floorPlans={floorPlans} jobs={jobs} />

      {/* full-screen single-photo editor — same Composer, scoped to one photo */}
      {openPhoto && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="font-serif text-sm">Editing photo</span>
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
            >
              Close ✕
            </button>
          </div>
          <div className="grid flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="flex items-start justify-center">
              {openPhoto.url && (
                // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                <img
                  src={openPhoto.url}
                  alt=""
                  className="max-h-[80vh] w-full rounded-lg object-contain"
                />
              )}
            </div>
            <div className="min-w-0">
              <Composer
                listingId={listingId}
                photos={photos}
                samples={samples}
                selectedIds={[openPhoto.id]}
                onClearSelection={() => setOpenId(null)}
                lastChain={lastChain}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
