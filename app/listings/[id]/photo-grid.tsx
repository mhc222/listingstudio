"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { ROOM_TYPES } from "@/lib/roomTypes"
import { tagPhoto } from "../actions"
import type { RoomProposalRow, SameRoomGroupRow } from "./room-organization"

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

type Room = { id: string; name: string; room_type: string }

function ProposalControls({ listingId, proposal, rooms }: { listingId: string; proposal: RoomProposalRow; rooms: Room[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roomChoice, setRoomChoice] = useState(proposal.proposed_room_id ?? "__new")
  const [roomName, setRoomName] = useState(proposal.proposed_room_name)
  const [roomType, setRoomType] = useState(proposal.proposed_room_type)
  const [linkViews, setLinkViews] = useState(Boolean(proposal.proposed_same_room_key))

  async function decide(action: "accept" | "defer") {
    setBusy(true)
    setError(null)
    const decision = action === "defer"
      ? { proposal_id: proposal.id, action }
      : {
          proposal_id: proposal.id,
          action,
          room_id: roomChoice === "__new" ? null : roomChoice,
          room_name: roomName,
          room_type: roomType,
          same_room_key: linkViews ? proposal.proposed_same_room_key : null,
        }
    try {
      const response = await fetch(`/api/listings/${listingId}/room-analysis/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: [decision] }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? "That room decision could not be saved.")
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That room decision could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2 border-t border-border/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[0.68rem] font-semibold uppercase tracking-wide ${proposal.review_state === "suggested" ? "text-emerald-700" : "text-amber-800"}`}>
          {proposal.review_state === "suggested" ? "Suggested" : "Needs review"}
        </span>
        <span className="text-[0.68rem] tabular-nums text-muted-foreground">{Math.round(proposal.confidence * 100)}%</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{proposal.evidence}</p>
      <Select value={roomChoice} onChange={(event) => setRoomChoice(event.target.value)} className="h-10 text-xs">
        <option value="__new">Create “{proposal.proposed_room_name}”</option>
        {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
      </Select>
      {roomChoice === "__new" && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input value={roomName} onChange={(event) => setRoomName(event.target.value)} aria-label="Room name" className="h-10 text-xs" />
          <Select value={roomType} onChange={(event) => setRoomType(event.target.value)} aria-label="Room type" className="h-10 text-xs">
            {ROOM_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </Select>
        </div>
      )}
      {proposal.proposed_same_room_key && (
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={linkViews} onChange={(event) => setLinkViews(event.target.checked)} className="mt-0.5" />
          Link the other suggested views of this room
        </label>
      )}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={() => decide("accept")} disabled={busy || (roomChoice === "__new" && !roomName.trim())}>{busy ? "Saving…" : "Confirm room"}</Button>
        <Button size="sm" variant="outline" onClick={() => decide("defer")} disabled={busy}>Leave untagged</Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function GroupStatus({ listingId, group, photoId }: { listingId: string; group: SameRoomGroupRow; photoId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function unlink() {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/listings/${listingId}/same-room-groups/${group.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoIds: group.memberPhotoIds.filter((id) => id !== photoId) }),
    })
    const data = await response.json().catch(() => null)
    setBusy(false)
    if (!response.ok) {
      setError(data?.error ?? "This view could not be unlinked.")
      return
    }
    router.refresh()
  }
  return (
    <div className="border-t border-border/60 px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-muted-foreground">Same room · {group.memberPhotoIds.length} views</span>
        <button type="button" onClick={unlink} disabled={busy} className="min-h-10 shrink-0 px-1 font-medium text-primary hover:underline disabled:opacity-50">{busy ? "Unlinking…" : "Unlink"}</button>
      </div>
      {error && <p className="mt-1 text-destructive">{error}</p>}
    </div>
  )
}

export function PhotoGrid({ photos, rooms, listingId, proposals = [], sameRoomGroups = [], selectedIds = [], onSelect, onOpen }: {
  photos: PhotoRow[]
  rooms: Room[]
  listingId: string
  proposals?: RoomProposalRow[]
  sameRoomGroups?: SameRoomGroupRow[]
  selectedIds?: string[]
  onSelect?: (index: number, shift: boolean) => void
  onOpen?: (index: number) => void
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  if (!photos.length) return <div className="rounded-2xl border border-dashed border-input/70 bg-card/45 p-10 text-center text-muted-foreground">No photos match these filters.</div>

  async function changeConfirmedProposal(proposal: RoomProposalRow, roomId: string) {
    if (!roomId) {
      startTransition(() => tagPhoto(proposal.photo_id, null, listingId))
      return
    }
    const response = await fetch(`/api/listings/${listingId}/room-analysis/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions: [{ proposal_id: proposal.id, action: "accept", room_id: roomId, same_room_key: null }] }),
    })
    if (response.ok) router.refresh()
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {photos.map((photo, index) => {
        const selected = selectedIds.includes(photo.id)
        const order = selectedIds.indexOf(photo.id)
        const roomName = rooms.find((room) => room.id === photo.room_id)?.name
        const proposal = proposals.find((item) => item.photo_id === photo.id)
        const group = sameRoomGroups.find((item) => item.memberPhotoIds.includes(photo.id))
        return (
          <div key={photo.id} className={`ls-pressable overflow-hidden rounded-2xl border-2 bg-card shadow-[0_2px_12px_rgba(45,35,23,0.06)] ${selected ? "border-primary shadow-[0_8px_24px_rgba(112,78,34,0.14)]" : "border-transparent hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(45,35,23,0.1)]"}`}>
            {photo.url && !photo.storage_path.endsWith(".pdf") ? (
              <button type="button" onClick={() => onOpen?.(index)} className="relative block w-full" title="Open full-screen editor">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that */}
                <img src={photo.url} alt={roomName ? `${roomName} listing photo` : "Untagged listing photo"} className="aspect-[4/3] w-full object-cover" />
                {onSelect && (
                  <span role="checkbox" aria-label={selected ? `Remove photo ${order + 1} from selection` : "Add photo to selection"} aria-checked={selected} tabIndex={0} onClick={(event) => { event.stopPropagation(); onSelect(index, event.shiftKey) }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onSelect(index, event.shiftKey) } }} className={`absolute left-1.5 top-1.5 flex h-10 w-10 items-center justify-center rounded-full border text-[11px] font-medium ${selected ? "border-primary bg-primary text-primary-foreground" : "border-white/80 bg-black/35 text-white/90"}`}>
                    {selected ? order + 1 : "＋"}
                  </span>
                )}
                {proposal?.review_state === "confirmed" && <span className="absolute right-2 top-2 rounded-md bg-emerald-950/80 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-white">Confirmed</span>}
              </button>
            ) : (
              <a href={photo.url ?? "#"} target="_blank" className="flex aspect-[4/3] items-center justify-center text-sm text-muted-foreground underline">PDF floor plan</a>
            )}
            {proposal?.decision === "pending" ? (
              <ProposalControls key={proposal.id} listingId={listingId} proposal={proposal} rooms={rooms} />
            ) : (
              <div className="p-2">
                <Select value={photo.room_id ?? ""} onChange={(event) => proposal?.decision === "accepted" ? changeConfirmedProposal(proposal, event.target.value) : startTransition(() => tagPhoto(photo.id, event.target.value || null, listingId))} className="h-10 text-xs">
                  <option value="">Untagged</option>
                  {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                </Select>
              </div>
            )}
            {group && <GroupStatus listingId={listingId} group={group} photoId={photo.id} />}
          </div>
        )
      })}
    </div>
  )
}
