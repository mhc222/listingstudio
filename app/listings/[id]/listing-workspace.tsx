"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { PhotoGrid, type PhotoRow } from "./photo-grid"
import { Composer } from "./composer"
import { ShootOrganization, type PhotoGroupRow } from "./shoot-organization"
import {
  RoomOrganization,
  type OrganizationFilter,
  type OrganizationState,
  type RoomAnalysisRunRow,
  type RoomProposalRow,
  type SameRoomGroupRow,
} from "./room-organization"
import { type JobRow, type SampleRow } from "./job-feed"
import type { SelectionMethod } from "@/lib/batch-scope"
import type { EditPresetDefaultRow, EditPresetRow } from "@/lib/edit-presets"
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
  inventoryPhotos,
  photoGroups,
  latestRoomAnalysis,
  roomProposals,
  sameRoomGroups,
  floorPlans,
  rooms,
  jobs,
  samples,
  presets,
  presetDefaults,
}: {
  listingId: string
  photos: PhotoRow[]
  inventoryPhotos: PhotoRow[]
  photoGroups: PhotoGroupRow[]
  latestRoomAnalysis: RoomAnalysisRunRow | null
  roomProposals: RoomProposalRow[]
  sameRoomGroups: SameRoomGroupRow[]
  floorPlans: PhotoRow[]
  rooms: RoomRow[]
  jobs: JobRow[]
  samples: SampleRow[]
  presets: EditPresetRow[]
  presetDefaults: EditPresetDefaultRow[]
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectionMethod, setSelectionMethod] = useState<SelectionMethod>("manual")
  const [activeRoom, setActiveRoom] = useState(ALL_ROOMS)
  const [organizationFilter, setOrganizationFilter] = useState<OrganizationFilter>("all")
  // anchor index for shift-click range select
  const [anchor, setAnchor] = useState<number | null>(null)
  const [rangeMode, setRangeMode] = useState(false)
  const [rangeStart, setRangeStart] = useState<number | null>(null)
  // full-screen single-photo editor (Matt, 2026-08-31): clicking a photo opens
  // it large with the Composer scoped to that one photo; the grid keeps the
  // corner-checkbox batch path. Esc closes.
  const [openId, setOpenId] = useState<string | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [additionalIds, setAdditionalIds] = useState<string[]>([])
  const [editorSubmitting, setEditorSubmitting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const openPhoto = photos.find((p) => p.id === openId) ?? null
  const studioIds = openPhoto ? [openPhoto.id, ...additionalIds] : []
  const selectedPhotos = selectedIds.flatMap((id) => {
    const photo = photos.find((item) => item.id === id)
    return photo ? [photo] : []
  })
  const roomFilteredPhotos =
    activeRoom === ALL_ROOMS
      ? photos
      : activeRoom === UNTAGGED_ROOM
        ? photos.filter((photo) => photo.room_id == null)
        : photos.filter((photo) => photo.room_id === activeRoom)
  const proposalByPhoto = new Map(roomProposals.map((proposal) => [proposal.photo_id, proposal]))
  const organizationState = (photo: PhotoRow): OrganizationState => {
    const proposal = proposalByPhoto.get(photo.id)
    if (proposal) return proposal.review_state
    return photo.room_id ? "confirmed" : "untagged"
  }
  const organizationCounts = photos.reduce<Record<OrganizationState, number>>(
    (counts, photo) => {
      counts[organizationState(photo)] += 1
      return counts
    },
    { suggested: 0, confirmed: 0, needs_review: 0, untagged: 0 }
  )
  const filteredPhotos = organizationFilter === "all"
    ? roomFilteredPhotos
    : roomFilteredPhotos.filter((photo) => organizationState(photo) === organizationFilter)
  const roomLabels = roomDisplayLabels(rooms)
  const roomOptions = rooms.map((room) => ({
    id: room.id,
    name: roomLabels.get(room.id) ?? room.name,
    room_type: room.room_type,
  }))
  const activeFilterLabel = organizationFilter !== "all"
    ? organizationFilter.replace("_", " ")
    : activeRoom === UNTAGGED_ROOM
      ? "Untagged"
      : roomLabels.get(activeRoom) ?? "this room"

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
    const root = dialogRef.current
    window.requestAnimationFrame(() => root?.querySelector<HTMLElement>("button, input, select, textarea")?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editorSubmitting) {
        setOpenId(null)
        setBatchOpen(false)
        setAdditionalIds([])
        window.requestAnimationFrame(() => returnFocusRef.current?.focus())
        return
      }
      if (e.key !== "Tab" || !root) return
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
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
    if (rangeMode) {
      if (rangeStart === null) {
        const id = filteredPhotos[index].id
        setRangeStart(index)
        setAnchor(index)
        setSelectionMethod("range")
        setSelectedIds((previous) => previous.includes(id) ? previous : [...previous, id])
        return
      }
      const [lo, hi] = rangeStart < index ? [rangeStart, index] : [index, rangeStart]
      const range = filteredPhotos.slice(lo, hi + 1).map((photo) => photo.id)
      setSelectedIds((previous) => Array.from(new Set([...previous, ...range])))
      setSelectionMethod("range")
      setRangeMode(false)
      setRangeStart(null)
      return
    }
    if (shift && anchor !== null) {
      const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor]
      const range = filteredPhotos.slice(lo, hi + 1).map((p) => p.id)
      setSelectedIds((prev) => Array.from(new Set([...prev, ...range])))
      setSelectionMethod("range")
      return
    }
    const id = filteredPhotos[index].id
    setAnchor(index)
    setSelectionMethod("manual")
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function clear() {
    setSelectedIds([])
    setAnchor(null)
    setRangeMode(false)
    setRangeStart(null)
    setSelectionMethod("manual")
  }

  function selectGroup(ids: string[], method: SelectionMethod) {
    setSelectedIds(ids)
    setSelectionMethod(method)
    setAnchor(null)
    setRangeMode(false)
    setRangeStart(null)
  }

  function changeRoomFilter(value: string) {
    setActiveRoom(value)
    clear()
  }

  function openSelection() {
    returnFocusRef.current = document.activeElement as HTMLElement | null
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
    window.requestAnimationFrame(() => returnFocusRef.current?.focus())
  }

  return (
    <div className="grid min-w-0 gap-7">
      {inventoryPhotos.length === 0 && (
        <section className="ls-surface p-6 text-center sm:p-8" aria-label="Empty listing">
          <h2 className="text-xl font-semibold tracking-[-0.025em]">No listing photos yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Add JPG, PNG, WebP, HEIC, or HEIF photos up to 50 MB each. Originals stay untouched, and each file reports its own resumable progress.</p>
          <Button
            type="button"
            className="mt-4"
            onClick={() => document.getElementById(`listing-photo-upload-${listingId}`)?.click()}
          >
            Upload photos
          </Button>
        </section>
      )}
      <ShootOrganization
        listingId={listingId}
        photos={inventoryPhotos}
        logicalPhotoCount={photos.length}
        floorPlanCount={floorPlans.length}
        groups={photoGroups}
      />
      <RoomOrganization
        listingId={listingId}
        latestRun={latestRoomAnalysis}
        proposals={roomProposals}
        counts={organizationCounts}
        filter={organizationFilter}
        onFilterChange={(next) => {
          setOrganizationFilter(next)
          clear()
        }}
        selectedPhotoIds={selectedIds}
      />
      <RoomBrowser
        listingId={listingId}
        rooms={rooms}
        photos={photos}
        floorPlans={floorPlans.map((plan) => ({ id: plan.id, url: plan.url }))}
        activeRoom={activeRoom}
        onActiveRoomChange={changeRoomFilter}
      />
      <section className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-[-0.025em]">
            Photos ({filteredPhotos.length}
            {activeRoom !== ALL_ROOMS ? ` of ${photos.length}` : ""})
          </h2>
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="rounded-full bg-accent px-2.5 py-1 font-ui text-[0.68rem] font-semibold text-accent-foreground">
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
        {filteredPhotos.length > 0 && (
          <div className="mb-3 rounded-xl border border-border/70 bg-card/55 p-3" aria-label="Batch selection">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-semibold">Batch selection</span>
              <Button type="button" size="sm" variant="outline" onClick={() => selectGroup(filteredPhotos.map((photo) => photo.id), "visible")}>
                Select all visible · {filteredPhotos.length}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={rangeMode ? "default" : "outline"}
                onClick={() => {
                  setRangeMode((current) => !current)
                  setRangeStart(null)
                  setAnchor(null)
                }}
              >
                {rangeMode ? rangeStart === null ? "Choose first photo" : "Choose last photo" : "Choose range"}
              </Button>
              {selectedIds.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={clear}>Clear</Button>}
            </div>
            <div className="mt-2 flex max-w-full gap-2 overflow-x-auto pb-1">
              {rooms.map((room) => {
                const ids = filteredPhotos.filter((photo) => photo.room_id === room.id).map((photo) => photo.id)
                return ids.length ? (
                  <button key={room.id} type="button" onClick={() => selectGroup(ids, "room")} className="min-h-10 shrink-0 rounded-md bg-muted/60 px-3 text-xs font-medium hover:bg-accent">
                    {roomLabels.get(room.id) ?? room.name} · {ids.length}
                  </button>
                ) : null
              })}
              {sameRoomGroups.map((group) => {
                const ids = filteredPhotos.filter((photo) => group.memberPhotoIds.includes(photo.id)).map((photo) => photo.id)
                return ids.length >= 2 ? (
                  <button key={group.id} type="button" onClick={() => selectGroup(ids, "same_room_group")} className="min-h-10 shrink-0 rounded-md bg-muted/60 px-3 text-xs font-medium hover:bg-accent">
                    {group.name} views · {ids.length}
                  </button>
                ) : null
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Shift-click a first and last corner control on desktop, or use Choose range on touch screens. Group actions select only photos in the current view.
            </p>
          </div>
        )}
        {filteredPhotos.length > 0 ? (
          <PhotoGrid
            photos={filteredPhotos}
            rooms={roomOptions}
            listingId={listingId}
            proposals={roomProposals}
            sameRoomGroups={sameRoomGroups}
            selectedIds={selectedIds}
            onSelect={selectPhoto}
            onOpen={(i) => {
              returnFocusRef.current = document.activeElement as HTMLElement | null
              setOpenId(filteredPhotos[i].id)
              setAdditionalIds([])
            }}
          />
        ) : photos.length > 0 ? (
          <div className="rounded-2xl border border-dashed border-input/70 bg-card/45 p-8 text-center text-muted-foreground">
            <p className="font-medium text-foreground">No photos match {activeFilterLabel}</p>
            <p className="mt-1 text-sm">Your photos and organization decisions are unchanged.</p>
            <Button type="button" variant="outline" className="mt-4" onClick={() => {
              setActiveRoom(ALL_ROOMS)
              setOrganizationFilter("all")
              clear()
            }}>Show all photos</Button>
          </div>
        ) : null}
        {filteredPhotos.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Click a photo to edit it full-screen · use the corner ＋ to select views for editing or same-room linking.
          </p>
        )}
      </section>

      {/* full-screen single-photo editor — same Composer, scoped to one photo */}
      {openPhoto && (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-50 bg-black/45 md:p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="photo-editor-title"
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background md:rounded-[1.25rem] md:border md:border-white/55 md:shadow-[0_30px_100px_rgba(15,12,9,0.35)]">
            <div className="ls-scroll-edge z-20 flex h-14 shrink-0 items-center justify-between bg-card/78 px-4 backdrop-blur-2xl md:px-5">
              <span id="photo-editor-title" className="text-[0.95rem] font-semibold tracking-[-0.015em]">Photo studio</span>
              <Button type="button" variant="outline" size="sm" onClick={closeEditor} disabled={editorSubmitting}>
                {editorSubmitting ? "Starting…" : "Close"}
                {!editorSubmitting && <span aria-hidden="true">×</span>}
              </Button>
            </div>
            <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(20rem,23.5rem)] md:overflow-hidden">
            <div className="order-1 flex min-h-[36vh] items-center justify-center bg-[#1b1917] p-3 sm:p-5 md:min-h-0 md:p-7 lg:p-10">
              {openPhoto.url && (
                // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                <img
                  src={openPhoto.url}
                  alt="Listing photo being edited"
                  className="max-h-[48vh] w-full rounded-md object-contain shadow-[0_26px_80px_rgba(0,0,0,0.3)] md:max-h-[calc(100dvh-8.5rem)]"
                />
              )}
            </div>
            <div className="order-2 min-w-0 overflow-y-auto bg-background px-4 py-5 pb-10 sm:px-5 md:px-5 md:py-6">
              <Composer
                listingId={listingId}
                photos={photos}
                samples={samples}
                selectedIds={studioIds}
                lastChain={lastChain}
                contextLabel={roomLabels.get(openPhoto.room_id ?? "") ?? "One photo"}
                initialRoomType={rooms.find((room) => room.id === openPhoto.room_id)?.room_type}
                rooms={rooms}
                sameRoomGroups={sameRoomGroups}
                presets={presets}
                presetDefaults={presetDefaults}
                selectionMethod={studioIds.length === 1 ? "single" : "manual"}
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
        </div>
      )}

      {batchOpen && selectedPhotos.length > 1 && (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-50 bg-black/45 md:p-3"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${selectedPhotos.length} photos`}
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background md:rounded-[1.25rem] md:border md:border-white/55 md:shadow-[0_30px_100px_rgba(15,12,9,0.35)]">
          <div className="ls-scroll-edge z-20 flex h-14 shrink-0 items-center justify-between bg-card/78 px-4 backdrop-blur-2xl md:px-5">
            <span className="text-[0.95rem] font-semibold tracking-[-0.015em]">Batch studio · {selectedPhotos.length} photos</span>
            <Button type="button" variant="outline" size="sm" onClick={closeEditor} disabled={editorSubmitting}>
              {editorSubmitting ? "Starting…" : "Close"}
              {!editorSubmitting && <span aria-hidden="true">×</span>}
            </Button>
          </div>
          <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(20rem,23.5rem)] md:overflow-hidden">
            <div className="order-1 grid content-start grid-cols-2 gap-2 bg-[#1b1917] p-3 sm:grid-cols-3 md:grid-cols-2 md:overflow-y-auto md:p-5 lg:grid-cols-3">
              {selectedPhotos.map((photo) =>
                photo.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                  <img
                    key={photo.id}
                    src={photo.url}
                    alt="Selected listing photo"
                    className="aspect-[4/3] w-full rounded-lg object-cover shadow-lg"
                  />
                ) : null
              )}
            </div>
            <div className="order-2 min-w-0 overflow-y-auto px-4 py-5 pb-10 sm:px-5 md:px-5 md:py-6">
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
                rooms={rooms}
                sameRoomGroups={sameRoomGroups}
                presets={presets}
                presetDefaults={presetDefaults}
                selectionMethod={selectionMethod}
                onSubmittingChange={setEditorSubmitting}
              />
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
