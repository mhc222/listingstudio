"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"

type Room = { id: string; name: string }

export function UploadPanel({ listingId, rooms }: { listingId: string; rooms: Room[] }) {
  const router = useRouter()
  const photoInput = useRef<HTMLInputElement>(null)
  const planInput = useRef<HTMLInputElement>(null)
  const hdrInput = useRef<HTMLInputElement>(null)
  const [roomId, setRoomId] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [hdrEnhance, setHdrEnhance] = useState(true)

  // HDR_MERGE (phase 14): 3-9 brackets -> fused photo; optional chain to
  // IMAGE_ENHANCEMENT rides the normal jobs route on the merged photo.
  async function doHdrMerge(files: FileList | null) {
    if (!files?.length) return
    if (files.length < 3 || files.length > 9) {
      setMessage("Select 3-9 bracketed exposures of the same shot.")
      if (hdrInput.current) hdrInput.current.value = ""
      return
    }
    setBusy(true)
    setMessage(`Merging ${files.length} brackets…`)
    const form = new FormData()
    form.set("listingId", listingId)
    if (roomId) form.set("roomId", roomId)
    for (const f of Array.from(files)) form.append("files", f)
    try {
      const res = await fetch("/api/hdr-merge", { method: "POST", body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "merge failed")
      if (hdrEnhance) {
        const jobRes = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listingId,
            photoId: json.photoId,
            editChain: [
              {
                edit_type: "IMAGE_ENHANCEMENT",
                options: { sky_replacement: false, day_sky_style: "any", grass_repair: false },
              },
            ],
            comment: "HDR merged bracket set",
          }),
        })
        setMessage(jobRes.ok ? "Merged — enhancement job running." : "Merged, but the enhancement job failed to start.")
      } else {
        setMessage("Merged.")
      }
      router.refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "HDR merge failed — try again.")
    } finally {
      setBusy(false)
      if (hdrInput.current) hdrInput.current.value = ""
    }
  }

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
      <Select
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
        className="w-auto"
        title="Quick-tag uploads to a room"
      >
        <option value="">No room tag</option>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            tag: {r.name}
          </option>
        ))}
      </Select>
      <Button variant="outline" disabled={busy} onClick={() => planInput.current?.click()}>
        Attach floor plan
      </Button>
      <input
        ref={hdrInput}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        className="hidden"
        onChange={(e) => doHdrMerge(e.target.files)}
      />
      <Button variant="outline" disabled={busy} onClick={() => hdrInput.current?.click()}>
        HDR merge brackets
      </Button>
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={hdrEnhance}
          onChange={(e) => setHdrEnhance(e.target.checked)}
        />
        enhance after merge
      </label>
      {message && <span className="text-sm text-muted-foreground">{message}</span>}
    </div>
  )
}
