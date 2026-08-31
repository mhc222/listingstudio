import { ROOM_TYPES } from "@/lib/roomTypes"
import { createRoom, deleteRoom, updateRoom } from "../actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"

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

// decimal feet (how the value is stored) → 13′9″ for display; metres pass through
function fmtDim(v: number | null, units: string): string {
  if (v == null) return ""
  if (units === "m") return `${v} m`
  const ft = Math.floor(v)
  const inch = Math.round((v - ft) * 12)
  return inch ? `${ft}′${inch}″` : `${ft}′`
}

// labeled, no-spinner number field so placeholders never truncate to "Lengt"
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
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Input name="name" placeholder="Name" defaultValue={room?.name} required className="flex-1" />
        <Select
          name="room_type"
          defaultValue={room?.room_type ?? "other"}
          className="w-auto"
        >
          {ROOM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
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

export function RoomPanel({ listingId, rooms }: { listingId: string; rooms: RoomRow[] }) {
  return (
    <div className="grid gap-2">
      {rooms.map((room) => (
        <details key={room.id} className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {room.name}
            <span className="ml-2 text-muted-foreground">
              {ROOM_TYPES.find((t) => t.value === room.room_type)?.label}
              {room.length && room.width
                ? ` · ${fmtDim(room.length, room.units)} × ${fmtDim(room.width, room.units)}`
                : ""}
            </span>
          </summary>
          <form action={updateRoom} className="mt-3 grid gap-2">
            <input type="hidden" name="listingId" value={listingId} />
            <input type="hidden" name="roomId" value={room.id} />
            <RoomFields room={room} />
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button type="submit" size="sm" variant="destructive" formAction={deleteRoom}>
                Delete
              </Button>
            </div>
          </form>
        </details>
      ))}
      <details className="rounded-lg border border-dashed p-3">
        <summary className="cursor-pointer text-sm text-muted-foreground">+ Add room</summary>
        <form action={createRoom} className="mt-3 grid gap-2">
          <input type="hidden" name="listingId" value={listingId} />
          <RoomFields />
          <Button type="submit" size="sm" className="justify-self-start">
            Add
          </Button>
        </form>
      </details>
    </div>
  )
}
