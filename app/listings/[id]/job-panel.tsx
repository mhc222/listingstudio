"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { ROOM_TYPES } from "@/lib/roomTypes"
import { FURNITURE_STYLES } from "@/lib/prompts"
import type { PhotoRow } from "./photo-grid"

export type SampleRow = { id: string; label: string | null; url: string | null }

export type JobRow = {
  id: string
  title: string
  status: string
  total_cost_cents: number
  grounding_used: { dimension_sentence?: string; floor_plan_photo_id?: string } | null
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

type ChainEdit = { edit_type: string; options: Record<string, unknown> }

const EDIT_TYPES: Record<string, { label: string; defaults: Record<string, unknown> }> = {
  ITEM_REMOVAL: { label: "Item removal", defaults: { tier: 1, items: "" } },
  IMAGE_ENHANCEMENT: {
    label: "Image enhancement",
    defaults: { sky_replacement: false, day_sky_style: "any", grass_repair: false },
  },
  TURN_ON_LIGHTS: { label: "Turn on lights", defaults: {} },
  VIRTUAL_STAGING: {
    label: "Virtual staging",
    defaults: { room_type: "living_room", furniture_style: "modern", furniture_required: "" },
  },
}

const SKY_STYLE_LABELS: Record<string, string> = {
  any: "Any sky",
  clear_blue: "Clear blue",
  clouds_blue: "Clouds + blue",
  orange_sunrise: "Orange sunrise",
}

const SIZE_PRESETS: Record<string, string> = {
  original: "Original size",
  under_10mb: "Under 10MB",
  under_5mb: "Under 5MB",
}

export function JobPanel({
  listingId,
  photos,
  jobs,
  samples,
}: {
  listingId: string
  photos: PhotoRow[]
  jobs: JobRow[]
  samples: SampleRow[]
}) {
  const router = useRouter()
  const [photoId, setPhotoId] = useState<string | null>(null)
  const [chain, setChain] = useState<ChainEdit[]>([])
  const [comment, setComment] = useState("")
  const [sizePreset, setSizePreset] = useState("original")
  const [sampleIds, setSampleIds] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleSample(id: string) {
    setSampleIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function addEdit(editType: string) {
    setChain((c) => [...c, { edit_type: editType, options: { ...EDIT_TYPES[editType].defaults } }])
  }

  function removeEdit(index: number) {
    setChain((c) => c.filter((_, i) => i !== index))
  }

  function setOption(index: number, key: string, value: unknown) {
    setChain((c) =>
      c.map((e, i) => (i === index ? { ...e, options: { ...e.options, [key]: value } } : e))
    )
  }

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
    if (!photoId || chain.length === 0) return
    setRunning(true)
    setError(null)
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId,
        photoId,
        editChain: chain,
        comment: comment.trim() || undefined,
        sizePreset,
        sampleImageIds: sampleIds.length ? sampleIds : undefined,
      }),
    })
    setRunning(false)
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? `request failed (${res.status})`)
      return
    }
    setChain([])
    setComment("")
    setPhotoId(null)
    setSampleIds([])
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
        <p className="mb-2 text-sm font-medium">New job</p>
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

            {chain.map((edit, i) => (
              <div key={i} className="mt-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {i + 1}. {EDIT_TYPES[edit.edit_type]?.label ?? edit.edit_type}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeEdit(i)}
                    className="text-xs text-muted-foreground hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
                {edit.edit_type === "ITEM_REMOVAL" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={Number(edit.options.tier)}
                      onChange={(e) => setOption(i, "tier", Number(e.target.value))}
                      className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
                    >
                      <option value={1}>Minor removal</option>
                      <option value={2}>Full declutter</option>
                    </select>
                    <input
                      value={String(edit.options.items ?? "")}
                      onChange={(e) => setOption(i, "items", e.target.value)}
                      placeholder="What should be removed? e.g. the boxes and the cat tree"
                      className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-sm"
                    />
                  </div>
                )}
                {edit.edit_type === "IMAGE_ENHANCEMENT" && (
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={Boolean(edit.options.sky_replacement)}
                        onChange={(e) => setOption(i, "sky_replacement", e.target.checked)}
                      />
                      Sky replacement
                    </label>
                    {Boolean(edit.options.sky_replacement) && (
                      <select
                        value={String(edit.options.day_sky_style)}
                        onChange={(e) => setOption(i, "day_sky_style", e.target.value)}
                        className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
                      >
                        {Object.entries(SKY_STYLE_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={Boolean(edit.options.grass_repair)}
                        onChange={(e) => setOption(i, "grass_repair", e.target.checked)}
                      />
                      Grass repair
                    </label>
                  </div>
                )}
                {edit.edit_type === "VIRTUAL_STAGING" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={String(edit.options.room_type)}
                      onChange={(e) => setOption(i, "room_type", e.target.value)}
                      className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
                    >
                      {ROOM_TYPES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={String(edit.options.furniture_style)}
                      onChange={(e) => setOption(i, "furniture_style", e.target.value)}
                      className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
                    >
                      {Object.entries(FURNITURE_STYLES).map(([k, { label }]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={String(edit.options.furniture_required ?? "")}
                      onChange={(e) => setOption(i, "furniture_required", e.target.value)}
                      placeholder="Required furniture (optional), e.g. a king bed and reading chair"
                      className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-sm"
                    />
                  </div>
                )}
              </div>
            ))}

            <div className="mt-3">
              <p className="text-xs font-medium text-muted-foreground">
                Reference images{" "}
                <Link href="/library" className="font-normal underline hover:text-foreground">
                  Sample library
                </Link>
              </p>
              {samples.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  No samples yet — add style references in the library.
                </p>
              ) : (
                <div className="mt-1 flex gap-2 overflow-x-auto pb-2">
                  {samples.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      title={s.label ?? ""}
                      onClick={() => toggleSample(s.id)}
                      className={`shrink-0 overflow-hidden rounded-md border-2 ${
                        sampleIds.includes(s.id) ? "border-blue-500" : "border-transparent"
                      }`}
                    >
                      {s.url && (
                        // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                        <img src={s.url} alt={s.label ?? ""} className="h-12 w-16 object-cover" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value=""
                onChange={(e) => e.target.value && addEdit(e.target.value)}
                className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
              >
                <option value="">+ Add edit…</option>
                {Object.entries(EDIT_TYPES).map(([k, { label }]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={sizePreset}
                onChange={(e) => setSizePreset(e.target.value)}
                className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
              >
                {Object.entries(SIZE_PRESETS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Optional notes for all steps"
                className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-sm"
              />
              <Button size="sm" onClick={run} disabled={!photoId || chain.length === 0 || running}>
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
              {job.grounding_used && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Grounding:{" "}
                  {[
                    job.grounding_used.dimension_sentence,
                    job.grounding_used.floor_plan_photo_id && "floor plan attached as reference",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
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
                            After (v{latest.version_number}) ·{" "}
                            <a
                              href={`/api/file-groups/${fg.id}/download`}
                              className="underline hover:text-foreground"
                            >
                              Download
                            </a>
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
