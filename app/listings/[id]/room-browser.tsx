"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { ROOM_TYPES } from "@/lib/roomTypes"
import { createRoom, deleteRoom, updateRoom } from "../actions"
import { ExtractRooms } from "./extract-rooms"

export const ALL_ROOMS = "__all"
export const UNTAGGED_ROOM = "__untagged"

export type RoomRow = {
  id: string
  name: string
  room_type: string
  length: number | null
  width: number | null
  ceiling_height: number | null
  units: string
  notes: string | null
}

type RoomPhoto = { id: string; room_id: string | null }

function fmtDim(v: number | null, units: string): string {
  if (v == null) return ""
  if (units === "m") return `${v} m`
  const ft = Math.floor(v)
  const inch = Math.round((v - ft) * 12)
  return inch ? `${ft}′${inch}″` : `${ft}′`
}

export function roomDimensions(room: RoomRow): string {
  return room.length != null && room.width != null
    ? `${fmtDim(room.length, room.units)} × ${fmtDim(room.width, room.units)}`
    : "Dimensions not set"
}

export function roomDisplayLabels(rooms: RoomRow[]): Map<string, string> {
  const totals = new Map<string, number>()
  const seen = new Map<string, number>()
  for (const room of rooms) totals.set(room.name, (totals.get(room.name) ?? 0) + 1)

  const labels = new Map<string, string>()
  for (const room of rooms) {
    const next = (seen.get(room.name) ?? 0) + 1
    seen.set(room.name, next)
    const typeLabel = ROOM_TYPES.find((type) => type.value === room.room_type)?.label
    const distinctBedroom = room.name.toLowerCase() === "bedroom" && room.room_type.startsWith("bedroom_")
    labels.set(
      room.id,
      totals.get(room.name) === 1
        ? room.name
        : distinctBedroom && typeLabel
          ? typeLabel
          : `${room.name} ${next}`
    )
  }
  return labels
}

function DimField({
  name,
  label,
  defaultValue,
}: {
  name: string
  label: string
  defaultValue?: number | null
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        name={name}
        type="number"
        step="any"
        inputMode="decimal"
        defaultValue={defaultValue ?? ""}
        className="text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  )
}

function RoomFields({ room }: { room?: RoomRow }) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input name="name" placeholder="Room name" defaultValue={room?.name} required />
        <Select name="room_type" defaultValue={room?.room_type ?? "other"} className="sm:w-auto">
          {ROOM_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <DimField name="length" label="Length" defaultValue={room?.length} />
        <DimField name="width" label="Width" defaultValue={room?.width} />
        <DimField name="ceiling_height" label="Ceiling" defaultValue={room?.ceiling_height} />
        <label className="grid gap-1 text-xs text-muted-foreground">
          Units
          <Select name="units" defaultValue={room?.units ?? "ft"}>
            <option value="ft">ft</option>
            <option value="m">m</option>
          </Select>
        </label>
      </div>
      <Input name="notes" placeholder="Notes" defaultValue={room?.notes ?? ""} />
    </div>
  )
}

function RoomPicker({
  rooms,
  photos,
  value,
  onChange,
}: {
  rooms: RoomRow[]
  photos: RoomPhoto[]
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const labels = useMemo(() => roomDisplayLabels(rooms), [rooms])
  const counts = useMemo(() => {
    const next = new Map<string, number>()
    for (const photo of photos) {
      const key = photo.room_id ?? UNTAGGED_ROOM
      next.set(key, (next.get(key) ?? 0) + 1)
    }
    return next
  }, [photos])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [open])

  const selectedRoom = rooms.find((room) => room.id === value)
  const selectedCount = value === ALL_ROOMS ? photos.length : counts.get(value) ?? 0
  const selectedLabel =
    value === ALL_ROOMS
      ? "All photos"
      : value === UNTAGGED_ROOM
        ? "Untagged"
        : selectedRoom
          ? labels.get(selectedRoom.id) ?? selectedRoom.name
          : "All photos"
  const needle = query.trim().toLowerCase()
  const visibleRooms = rooms.filter((room) => {
    const type = ROOM_TYPES.find((item) => item.value === room.room_type)?.label ?? ""
    return `${labels.get(room.id)} ${room.name} ${type} ${roomDimensions(room)}`
      .toLowerCase()
      .includes(needle)
  })

  function choose(next: string) {
    onChange(next)
    setOpen(false)
    setQuery("")
  }

  return (
    <div ref={rootRef} className="relative w-full sm:w-[23rem]">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between border-b border-input bg-transparent px-1 text-left text-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="truncate font-medium">{selectedLabel}</span>
        <span className="ml-3 shrink-0 text-xs text-muted-foreground">
          {selectedCount} {selectedCount === 1 ? "photo" : "photos"}&nbsp;⌄
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+0.35rem)] z-30 w-full min-w-[18rem] border border-border bg-popover p-2 shadow-[0_18px_45px_rgba(76,58,35,0.16)]">
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false)
            }}
            placeholder="Search name, type, or dimensions"
            aria-label="Search rooms"
            className="mb-2"
          />
          <div role="listbox" aria-label="Room photo filter" className="max-h-72 overflow-y-auto">
            {!needle && (
              <>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === ALL_ROOMS}
                  onClick={() => choose(ALL_ROOMS)}
                  className="flex w-full items-center justify-between px-2 py-2 text-left text-sm hover:bg-accent"
                >
                  <span>All photos</span>
                  <span className="tabular-nums text-muted-foreground">{photos.length}</span>
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === UNTAGGED_ROOM}
                  onClick={() => choose(UNTAGGED_ROOM)}
                  className="flex w-full items-center justify-between px-2 py-2 text-left text-sm hover:bg-accent"
                >
                  <span>Untagged</span>
                  <span className="tabular-nums text-muted-foreground">
                    {counts.get(UNTAGGED_ROOM) ?? 0}
                  </span>
                </button>
                <div className="my-1 border-t" />
              </>
            )}
            {visibleRooms.map((room) => {
              const type = ROOM_TYPES.find((item) => item.value === room.room_type)?.label ?? "Other"
              return (
                <button
                  key={room.id}
                  type="button"
                  role="option"
                  aria-selected={value === room.id}
                  onClick={() => choose(room.id)}
                  className={`grid w-full grid-cols-[1fr_auto] gap-x-3 px-2 py-2 text-left text-sm hover:bg-accent ${
                    value === room.id ? "bg-accent" : ""
                  }`}
                >
                  <span className="truncate font-medium">{labels.get(room.id)}</span>
                  <span className="row-span-2 self-center tabular-nums text-muted-foreground">
                    {counts.get(room.id) ?? 0}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {type} · {roomDimensions(room)}
                  </span>
                </button>
              )
            })}
            {visibleRooms.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">No rooms found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function RoomBrowser({
  listingId,
  rooms,
  photos,
  floorPlans,
  activeRoom,
  onActiveRoomChange,
}: {
  listingId: string
  rooms: RoomRow[]
  photos: RoomPhoto[]
  floorPlans: { id: string; url: string | null }[]
  activeRoom: string
  onActiveRoomChange: (value: string) => void
}) {
  const labels = useMemo(() => roomDisplayLabels(rooms), [rooms])
  const room = rooms.find((item) => item.id === activeRoom)
  const typeLabel = room
    ? ROOM_TYPES.find((type) => type.value === room.room_type)?.label ?? "Other"
    : null
  const photoCount = room ? photos.filter((photo) => photo.room_id === room.id).length : 0

  return (
    <section aria-labelledby="room-browser-title" className="border-y border-border py-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="font-ui text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
            Browse the listing
          </p>
          <h2 id="room-browser-title" className="mt-1 font-serif text-xl">
            Rooms & photos
          </h2>
        </div>
        <RoomPicker rooms={rooms} photos={photos} value={activeRoom} onChange={onActiveRoomChange} />
      </div>

      {room ? (
        <div className="mt-4 grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <p className="font-serif text-2xl">{labels.get(room.id) ?? room.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {typeLabel} · {roomDimensions(room)} · {photoCount} tagged photo{photoCount === 1 ? "" : "s"}
            </p>
            {room.notes && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{room.notes}</p>}
          </div>
          <details className="group sm:min-w-24">
            <summary className="cursor-pointer list-none text-sm font-medium text-primary hover:underline">
              Edit room
            </summary>
            <form action={updateRoom} className="mt-3 grid gap-3 bg-muted/35 p-3 sm:min-w-[34rem]">
              <input type="hidden" name="listingId" value={listingId} />
              <input type="hidden" name="roomId" value={room.id} />
              <RoomFields room={room} />
              <div className="flex gap-2">
                <Button type="submit" size="sm">Save room</Button>
                <Button type="submit" size="sm" variant="destructive" formAction={deleteRoom}>
                  Delete
                </Button>
              </div>
            </form>
          </details>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {activeRoom === UNTAGGED_ROOM
            ? "Photos without a room assignment. Use the selector on each photo to tag it."
            : `${rooms.length} rooms · choose one to see its dimensions and tagged photos.`}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2">
        <details>
          <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground">
            + Add room
          </summary>
          <form action={createRoom} className="mt-3 grid max-w-2xl gap-3 bg-muted/35 p-3">
            <input type="hidden" name="listingId" value={listingId} />
            <RoomFields />
            <Button type="submit" size="sm" className="justify-self-start">Add room</Button>
          </form>
        </details>
        <ExtractRooms listingId={listingId} floorPlans={floorPlans} compact />
      </div>
    </section>
  )
}
