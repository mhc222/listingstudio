"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import type { PhotoRow } from "./photo-grid"

export type JobRow = {
  id: string
  title: string
  status: string
  total_cost_cents: number
  file_groups: {
    id: string
    primary_photo_id: string
    current_step: number
    step_status: string
    last_error: string | null
    edit_chain: { edit_type: string }[]
    output_versions: { version_number: number; url: string | null }[]
  }[]
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  processing: "bg-blue-100 text-blue-800",
  complete: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
}

export function JobPanel({
  listingId,
  photos,
  jobs,
}: {
  listingId: string
  photos: PhotoRow[]
  jobs: JobRow[]
}) {
  const router = useRouter()
  const [photoId, setPhotoId] = useState<string | null>(null)
  const [tier, setTier] = useState<1 | 2>(1)
  const [items, setItems] = useState("")
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const photoById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])

  // live status: refetch server data whenever job state changes
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`jobs-${listingId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "file_groups" }, () =>
        router.refresh()
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () =>
        router.refresh()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [listingId, router])

  async function run() {
    if (!photoId) return
    setRunning(true)
    setError(null)
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId,
        photoId,
        editChain: [{ edit_type: "ITEM_REMOVAL", options: { tier, items } }],
      }),
    })
    setRunning(false)
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? `request failed (${res.status})`)
      return
    }
    setItems("")
    setPhotoId(null)
    router.refresh()
  }

  async function rerun(fileGroupId: string) {
    await fetch(`/api/file-groups/${fileGroupId}/rerun`, { method: "POST" })
    router.refresh()
  }

  return (
    <section>
      <h2 className="mb-3 text-lg font-medium">Jobs</h2>

      <div className="rounded-lg border p-4">
        <p className="mb-2 text-sm font-medium">Item removal</p>
        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Upload photos first.</p>
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {photos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPhotoId(p.id === photoId ? null : p.id)}
                  className={`shrink-0 overflow-hidden rounded-md border-2 ${
                    p.id === photoId ? "border-blue-500" : "border-transparent"
                  }`}
                >
                  {p.url && (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                    <img src={p.url} alt="" className="h-16 w-24 object-cover" />
                  )}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={tier}
                onChange={(e) => setTier(Number(e.target.value) as 1 | 2)}
                className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
              >
                <option value={1}>Minor removal</option>
                <option value={2}>Full declutter</option>
              </select>
              <input
                value={items}
                onChange={(e) => setItems(e.target.value)}
                placeholder="What should be removed? e.g. the boxes and the cat tree"
                className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-sm"
              />
              <Button size="sm" onClick={run} disabled={!photoId || !items.trim() || running}>
                {running ? "Submitting…" : "Run"}
              </Button>
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </>
        )}
      </div>

      {jobs.length > 0 && (
        <div className="mt-4 grid gap-3">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{job.title}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    STATUS_STYLES[job.status] ?? "bg-muted"
                  }`}
                >
                  {job.status}
                </span>
              </div>
              {job.file_groups.map((fg) => {
                const before = photoById.get(fg.primary_photo_id)
                const latest = [...fg.output_versions].sort(
                  (a, b) => b.version_number - a.version_number
                )[0]
                return (
                  <div key={fg.id} className="mt-3">
                    <p className="text-xs text-muted-foreground">
                      Step {fg.current_step + 1}/{fg.edit_chain.length} — {fg.step_status}
                      {job.total_cost_cents > 0 &&
                        ` · ${(Number(job.total_cost_cents) / 100).toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 3,
                        })}`}
                    </p>
                    {fg.step_status === "failed" && (
                      <div className="mt-1 flex items-center gap-2">
                        <p className="text-xs text-red-600">{fg.last_error}</p>
                        <Button size="sm" variant="outline" onClick={() => rerun(fg.id)}>
                          Re-run
                        </Button>
                      </div>
                    )}
                    {latest?.url && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <figure>
                          {before?.url && (
                            // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                            <img src={before.url} alt="" className="w-full rounded-md" />
                          )}
                          <figcaption className="mt-1 text-xs text-muted-foreground">
                            Before
                          </figcaption>
                        </figure>
                        <figure>
                          {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that */}
                          <img src={latest.url} alt="" className="w-full rounded-md" />
                          <figcaption className="mt-1 text-xs text-muted-foreground">
                            After (v{latest.version_number})
                          </figcaption>
                        </figure>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
