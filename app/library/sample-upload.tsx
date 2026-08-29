"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function SampleUpload() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const files = fileRef.current?.files
    if (!files?.length) return
    setBusy(true)
    setError(null)
    const form = new FormData()
    for (const f of files) form.append("files", f)
    if (label.trim()) form.append("label", label.trim())
    const res = await fetch("/api/samples", { method: "POST", body: form })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.errors?.join("; ") ?? data?.error ?? `upload failed (${res.status})`)
      return
    }
    if (data?.errors?.length) setError(data.errors.join("; "))
    setLabel("")
    if (fileRef.current) fileRef.current.value = ""
    router.refresh()
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          multiple
          className="text-sm"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
        />
        <Button size="sm" onClick={submit} disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
