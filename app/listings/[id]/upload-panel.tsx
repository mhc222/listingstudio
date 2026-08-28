"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

type Room = { id: string; name: string }

export function UploadPanel({ listingId, rooms }: { listingId: string; rooms: Room[] }) {
  const router = useRouter()
  const photoInput = useRef<HTMLInputElement>(null)
  const planInput = useRef<HTMLInputElement>(null)
  const [roomId, setRoomId] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  async function doUpload(files: FileList | null, isFloorPlan: boolean) {
    if (!files?.length) return
    setBusy(true)
    setMessage(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`)
    const form = new FormData()
    form.set("listingId", listingId)
    if (!isFloorPlan && roomId) form.set("roomId", roomId)
    form.set("isFloorPlan", String(isFloorPlan))
    for (const f of Array.from(files)) form.append("files", f)
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form })
      const json = await res.json()
      setMessage(
        [
          json.uploaded?.length ? `Uploaded ${json.uploaded.length}.` : "",
          ...(json.errors ?? []),
        ]
          .filter(Boolean)
          .join(" ")
      )
      router.refresh()
    } catch {
      setMessage("Upload failed — try again.")
    } finally {
      setBusy(false)
      if (photoInput.current) photoInput.current.value = ""
      if (planInput.current) planInput.current.value = ""
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={photoInput}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        className="hidden"
        onChange={(e) => doUpload(e.target.files, false)}
      />
      <input
        ref={planInput}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf"
        className="hidden"
        onChange={(e) => doUpload(e.target.files, true)}
      />
      <Button disabled={busy} onClick={() => photoInput.current?.click()}>
        Upload photos
      </Button>
      <select
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
        className="h-9 rounded-md border bg-transparent px-2 text-sm"
        title="Quick-tag uploads to a room"
      >
        <option value="">No room tag</option>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            tag: {r.name}
          </option>
        ))}
      </select>
      <Button variant="outline" disabled={busy} onClick={() => planInput.current?.click()}>
        Attach floor plan
      </Button>
      {message && <span className="text-sm text-muted-foreground">{message}</span>}
    </div>
  )
}
