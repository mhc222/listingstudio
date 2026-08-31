"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { PhotoGrid, type PhotoRow } from "./photo-grid"
import { Composer } from "./composer"
import { type JobRow, type SampleRow } from "./job-feed"
import {
  ALL_ROOMS,
  RoomBrowser,
  UNTAGGED_ROOM,
  roomDisplayLabels,
  type RoomRow,
} from "./room-browser"

// One selection surface feeds focused editors. The listing stays photo-first:
// the composer only mounts after a photo opens or a batch is explicitly chosen.
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
  const [batchOpen, setBatchOpen] = useState(false)
  const [additionalIds, setAdditionalIds] = useState<string[]>([])
  const [editorSubmitting, setEditorSubmitting] = useState(false)
  const openPhoto = photos.find((p) => p.id === openId) ?? null
  const studioIds = openPhoto ? [openPhoto.id, ...additionalIds] : []
  const selectedPhotos = photos.filter((photo) => selectedIds.includes(photo.id))
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
    if (!openId && !batchOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || editorSubmitting) return
      setOpenId(null)
      setBatchOpen(false)
      setAdditionalIds([])
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [openId, batchOpen, editorSubmitting])

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

  function openSelection() {
    if (selectedIds.length === 1) {
      setOpenId(selectedIds[0])
      setAdditionalIds([])
      clear()
      return
    }
    if (selectedIds.length > 1) setBatchOpen(true)
  }

  function closeEditor() {
    if (editorSubmitting) return
    setOpenId(null)
    setBatchOpen(false)
    setAdditionalIds([])
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
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="rounded-full border border-primary bg-accent px-2 py-0.5 font-ui uppercase tracking-wide text-accent-foreground">
                {selectedIds.length} selected
              </span>
              <Button size="sm" onClick={openSelection}>
                {selectedIds.length === 1 ? "Edit photo" : `Edit ${selectedIds.length} photos`}
              </Button>
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
          onOpen={(i) => {
            setOpenId(filteredPhotos[i].id)
            setAdditionalIds([])
          }}
        />
        {filteredPhotos.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Click a photo to edit it full-screen · use the corner ＋ to batch-select several.
          </p>
        )}
      </section>

      {/* full-screen single-photo editor — same Composer, scoped to one photo */}
      {openPhoto && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="font-serif text-lg">Edit photo</span>
            <button
              type="button"
              onClick={closeEditor}
              disabled={editorSubmitting}
              className="border px-3 py-1 text-sm hover:bg-muted disabled:cursor-wait disabled:opacity-50"
            >
              {editorSubmitting ? "Starting…" : "Close ✕"}
            </button>
          </div>
          <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(21rem,25rem)_minmax(0,1fr)] lg:overflow-hidden">
            <div className="order-1 flex min-h-[32vh] items-center justify-center bg-[#241f1a] p-4 lg:order-2 lg:min-h-0 lg:p-8">
              {openPhoto.url && (
                // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                <img
                  src={openPhoto.url}
                  alt="Listing photo being edited"
                  className="max-h-[42vh] w-full object-contain shadow-[0_24px_80px_rgba(0,0,0,0.28)] lg:max-h-[calc(100vh-9rem)]"
                />
              )}
            </div>
            <div className="order-2 min-w-0 overflow-y-auto bg-card p-4 pb-8 lg:order-1 lg:p-5">
              <Composer
                listingId={listingId}
                photos={photos}
                samples={samples}
                selectedIds={studioIds}
                lastChain={lastChain}
                contextLabel={roomLabels.get(openPhoto.room_id ?? "") ?? "One photo"}
                initialRoomType={rooms.find((room) => room.id === openPhoto.room_id)?.room_type}
                onSubmittingChange={setEditorSubmitting}
                additionalViews={photos
                  .filter((photo) => photo.id !== openPhoto.id)
                  .sort((a, b) => Number(b.room_id === openPhoto.room_id) - Number(a.room_id === openPhoto.room_id))
                  .map((photo) => ({
                    id: photo.id,
                    url: photo.url,
                    label: roomLabels.get(photo.room_id ?? "") ?? "Other room",
                    sameRoom: Boolean(openPhoto.room_id && photo.room_id === openPhoto.room_id),
                  }))}
                onToggleAdditionalView={(id) =>
                  setAdditionalIds((current) =>
                    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
                  )
                }
              />
            </div>
          </div>
        </div>
      )}

      {batchOpen && selectedPhotos.length > 1 && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${selectedPhotos.length} photos`}
        >
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="font-serif text-lg">Batch edit · {selectedPhotos.length} photos</span>
            <button
              type="button"
              onClick={closeEditor}
              disabled={editorSubmitting}
              className="border px-3 py-1 text-sm hover:bg-muted disabled:cursor-wait disabled:opacity-50"
            >
              {editorSubmitting ? "Starting…" : "Close ✕"}
            </button>
          </div>
          <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-4 lg:grid-cols-[minmax(16rem,0.75fr)_minmax(30rem,1.25fr)]">
            <div className="grid content-start grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
              {selectedPhotos.map((photo) =>
                photo.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                  <img
                    key={photo.id}
                    src={photo.url}
                    alt="Selected listing photo"
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : null
              )}
            </div>
            <div className="min-w-0">
              <Composer
                listingId={listingId}
                photos={photos}
                samples={samples}
                selectedIds={selectedIds}
                lastChain={lastChain}
                contextLabel={`${selectedPhotos.length} photos`}
                initialRoomType={
                  selectedPhotos.every((photo) => photo.room_id === selectedPhotos[0]?.room_id)
                    ? rooms.find((room) => room.id === selectedPhotos[0]?.room_id)?.room_type
                    : null
                }
                onSubmittingChange={setEditorSubmitting}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
