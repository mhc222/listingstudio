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
      <div className="flex gap-2">
        <Input name="length" type="number" step="any" placeholder="Length" defaultValue={room?.length ?? ""} />
        <Input name="width" type="number" step="any" placeholder="Width" defaultValue={room?.width ?? ""} />
        <Input
          name="ceiling_height"
          type="number"
          step="any"
          placeholder="Ceiling"
          defaultValue={room?.ceiling_height ?? ""}
        />
        <Select
          name="units"
          defaultValue={room?.units ?? "ft"}
          className="w-auto"
        >
          <option value="ft">ft</option>
          <option value="m">m</option>
        </Select>
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
                ? ` · ${room.length} × ${room.width} ${room.units}`
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
