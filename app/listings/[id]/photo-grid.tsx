"use client"

import { useTransition } from "react"
import { tagPhoto } from "../actions"

export type PhotoRow = {
  id: string
  room_id: string | null
  storage_path: string
  is_floor_plan: boolean
  width: number | null
  height: number | null
  url: string | null
}

type Room = { id: string; name: string }

export function PhotoGrid({
  photos,
  rooms,
  listingId,
  selectedIds = [],
  onSelect,
}: {
  photos: PhotoRow[]
  rooms: Room[]
  listingId: string
  // selection (phase 29): the grid is the one selection surface; clicking a
  // photo toggles it, shift-click ranges. Omitted → plain read-only grid.
  selectedIds?: string[]
  onSelect?: (index: number, shift: boolean) => void
}) {
  const [, startTransition] = useTransition()

  if (!photos.length)
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
        No photos yet. Upload some above.
      </div>
    )

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((p, i) => {
        const selected = selectedIds.includes(p.id)
        const order = selectedIds.indexOf(p.id)
        return (
          <div
            key={p.id}
            className={`overflow-hidden rounded-lg border-2 ${
              selected ? "border-primary" : "border-transparent ring-1 ring-border"
            }`}
          >
            {p.url && !p.storage_path.endsWith(".pdf") ? (
              <button
                type="button"
                onClick={(e) => onSelect?.(i, e.shiftKey)}
                className="relative block w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that */}
                <img src={p.url} alt="" className="aspect-[4/3] w-full object-cover" />
                {selected && (
                  <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
                    {order + 1}
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
              <select
                value={p.room_id ?? ""}
                onChange={(e) =>
                  startTransition(() => tagPhoto(p.id, e.target.value || null, listingId))
                }
                className="w-full rounded-md border bg-transparent px-1 py-1 text-xs"
              >
                <option value="">Untagged</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )
      })}
    </div>
  )
}
