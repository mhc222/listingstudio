"use client"

import { useTransition } from "react"
import { Select } from "@/components/ui/select"
import { tagPhoto } from "../actions"

export type PhotoRow = {
  id: string
  room_id: string | null
  storage_path: string
  is_floor_plan: boolean
  width: number | null
  height: number | null
  original_filename?: string | null
  source_batch_id?: string | null
  intake_order?: number | null
  captured_at?: string | null
  exposure_time_seconds?: number | null
  exposure_bias_ev?: number | null
  aperture_f_number?: number | null
  iso?: number | null
  focal_length_mm?: number | null
  camera_make?: string | null
  camera_model?: string | null
  lens_model?: string | null
  photo_role?: "source" | "hdr_merged"
  hdr_group_id?: string | null
  hdr_decision?: "unreviewed" | "single"
  url: string | null
}

type Room = { id: string; name: string }

export function PhotoGrid({
  photos,
  rooms,
  listingId,
  selectedIds = [],
  onSelect,
  onOpen,
}: {
  photos: PhotoRow[]
  rooms: Room[]
  listingId: string
  // selection (phase 29): shift/range batch-select via the corner checkbox.
  // Omitted → plain read-only grid.
  selectedIds?: string[]
  onSelect?: (index: number, shift: boolean) => void
  // clicking a photo opens the full-screen single-photo editor (Matt, 2026-08-31)
  onOpen?: (index: number) => void
}) {
  const [, startTransition] = useTransition()

  if (!photos.length)
    return (
      <div className="rounded-2xl border border-dashed border-input/70 bg-card/45 p-10 text-center text-muted-foreground">
        No photos yet. Upload some above.
      </div>
    )

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((p, i) => {
        const selected = selectedIds.includes(p.id)
        const order = selectedIds.indexOf(p.id)
        const roomName = rooms.find((room) => room.id === p.room_id)?.name
        return (
          <div
            key={p.id}
            className={`ls-pressable overflow-hidden rounded-2xl border-2 bg-card shadow-[0_2px_12px_rgba(45,35,23,0.06)] ${
              selected ? "border-primary shadow-[0_8px_24px_rgba(112,78,34,0.14)]" : "border-transparent hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(45,35,23,0.1)]"
            }`}
          >
            {p.url && !p.storage_path.endsWith(".pdf") ? (
              <button
                type="button"
                onClick={() => onOpen?.(i)}
                className="relative block w-full"
                title="Open full-screen editor"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that */}
                <img
                  src={p.url}
                  alt={roomName ? `${roomName} listing photo` : "Untagged listing photo"}
                  className="aspect-[4/3] w-full object-cover"
                />
                {/* corner checkbox = batch selection (multi-photo run); the image
                    itself opens the full-screen editor */}
                {onSelect && (
                  <span
                    role="checkbox"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(i, e.shiftKey)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        e.stopPropagation()
                        onSelect(i, e.shiftKey)
                      }
                    }}
                    className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-medium ${
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-white/80 bg-black/30 text-transparent hover:text-white/80"
                    }`}
                  >
                    {selected ? order + 1 : "＋"}
                  </span>
                )}
              </button>
            ) : (
              <a
                href={p.url ?? "#"}
                target="_blank"
                className="flex aspect-[4/3] items-center justify-center text-sm text-muted-foreground underline"
              >
                PDF floor plan
              </a>
            )}
            <div className="p-2">
              <Select
                value={p.room_id ?? ""}
                onChange={(e) =>
                  startTransition(() => tagPhoto(p.id, e.target.value || null, listingId))
                }
                className="h-8 text-xs"
              >
                <option value="">Untagged</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )
      })}
    </div>
  )
}
