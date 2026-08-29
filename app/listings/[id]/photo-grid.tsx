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
}: {
  photos: PhotoRow[]
  rooms: Room[]
  listingId: string
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
      {photos.map((p) => (
        <div key={p.id} className="overflow-hidden rounded-lg border">
          {p.url && !p.storage_path.endsWith(".pdf") ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
            <img src={p.url} alt="" className="aspect-[4/3] w-full object-cover" />
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
      ))}
    </div>
  )
}
