"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { ROOM_TYPES } from "@/lib/roomTypes"
import { ENHANCEMENT_STYLES, FURNITURE_STYLES, LIGHT_PRESETS } from "@/lib/prompts"
import { StatePill } from "@/components/brand"
import { simulateCents } from "@/lib/simulate"
import type { PhotoRow } from "./photo-grid"

// konva touches window — client-only (same pattern as the aerial panel)
const MarkupCanvas = dynamic(
  () => import("@/components/markup-canvas").then((m) => m.MarkupCanvas),
  { ssr: false }
)

export type SampleRow = {
  id: string
  label: string | null
  use_count: number
  url: string | null
}

// MLS compliance checklist stored on an output version (phase 21, migration
// 0008); null pre-migration and on non-compliance chains.
export type ComplianceNote = {
  checked_at?: string
  checks?: { id: string; label: string; pass: boolean; note?: string }[]
} | null

export type JobRow = {
  id: string
  title: string
  status: string
  kind: string
  total_cost_cents: number
  grounding_used: { dimension_sentence?: string; floor_plan_photo_id?: string } | null
  file_groups: {
    id: string
    primary_photo_id: string
    current_step: number
    step_status: string
    last_error: string | null
    comment: string | null
    edit_chain: { edit_type: string; options?: Record<string, unknown> }[]
    output_versions: {
      id: string
      version_number: number
      parent_version_id: string | null
      qa_note: string | null
      compliance: ComplianceNote
      url: string | null
    }[]
    chat_messages: { role: string; content: string; created_at: string }[]
  }[]
}

type ChainEdit = { edit_type: string; options: Record<string, unknown> }

const EDIT_TYPES: Record<string, { label: string; defaults: Record<string, unknown> }> = {
  ITEM_REMOVAL: { label: "Item removal", defaults: { tier: 1, items: "" } },
  // markup-to-edit (phase 23): drag-drawn marks drive the edit; gemini-only
  MARKUP_EDIT: { label: "Markup edit (draw on the photo)", defaults: {} },
  IMAGE_ENHANCEMENT: {
    label: "Image enhancement",
    defaults: {
      sky_replacement: false,
      day_sky_style: "any",
      grass_repair: false,
      style_preset: "natural",
    },
  },
  TURN_ON_LIGHTS: { label: "Turn on lights", defaults: {} },
  VIRTUAL_STAGING: {
    label: "Virtual staging",
    defaults: { room_type: "living_room", furniture_style: "modern", furniture_required: "" },
  },
  VIRTUAL_RENOVATION: {
    label: "Virtual renovation",
    defaults: { tier: "mid", changes: "" },
  },
  VIRTUAL_LANDSCAPING: { label: "Virtual landscaping", defaults: { instructions: "" } },
  DAY_TO_DUSK: { label: "Day to dusk / relight", defaults: { preset: "dusk" } },
  COLOUR_CHANGE: { label: "Colour change", defaults: { element: "", colour: "" } },
  SHADOW_REMOVAL: { label: "Shadow removal", defaults: {} },
  AERIAL_EDITING: {
    label: "Aerial enhancement",
    defaults: { sky_replacement: false, day_sky_style: "any", grass_repair: false },
  },
  PORTRAIT_RETOUCHING: { label: "Portrait retouch", defaults: {} },
  // Experimental 360 edits (phase 17): equirect (2:1) input only, output
  // flagged for manual seam/pole review
  "360_IMAGE_ENHANCEMENT": {
    label: "360 enhancement (experimental)",
    defaults: { sky_replacement: false, day_sky_style: "any", grass_repair: false },
  },
  "360_ITEM_REMOVAL": { label: "360 item removal (experimental)", defaults: { tier: 1, items: "" } },
  "360_VIRTUAL_STAGING": {
    label: "360 virtual staging (experimental)",
    defaults: { room_type: "living_room", furniture_style: "modern", furniture_required: "" },
  },
}

const EDIT_360_TYPES = ["360_IMAGE_ENHANCEMENT", "360_ITEM_REMOVAL", "360_VIRTUAL_STAGING"]

const RENOVATION_TIER_LABELS: Record<string, string> = {
  light: "Light touch",
  mid: "Mid renovation",
  full: "Full renovation",
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
  floorPlans = [],
  jobs,
  samples,
}: {
  listingId: string
  photos: PhotoRow[]
  // plan redraw jobs (phase 11) have a floor plan as their primary photo —
  // included here only for before-image lookup, never in the picker strip
  floorPlans?: PhotoRow[]
  jobs: JobRow[]
  samples: SampleRow[]
}) {
  const router = useRouter()
  // batch (phase 10): multi-select; the chat path requires exactly one photo
  const [photoIds, setPhotoIds] = useState<string[]>([])
  const [chain, setChain] = useState<ChainEdit[]>([])
  const [comment, setComment] = useState("")
  const [sizePreset, setSizePreset] = useState("original")
  const [sampleIds, setSampleIds] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // interpreter chat (phase 7): conversation is ephemeral until a job is
  // created, then persisted to chat_messages on the new file group
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([])
  const [chatText, setChatText] = useState("")
  const [chipEdit, setChipEdit] = useState("")
  const [chipRoom, setChipRoom] = useState("")
  const [chipStyle, setChipStyle] = useState("")
  const [interpreting, setInterpreting] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  // inspiration (phase 9): URL extraction picker
  const [urlText, setUrlText] = useState("")
  const [urlImages, setUrlImages] = useState<string[]>([])
  const [urlBusy, setUrlBusy] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [importedUrls, setImportedUrls] = useState<Record<string, boolean>>({})
  const [uploadingRef, setUploadingRef] = useState(false)

  function togglePhoto(id: string) {
    setPhotoIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

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

  const photoById = useMemo(
    () => new Map([...photos, ...floorPlans].map((p) => [p.id, p])),
    [photos, floorPlans]
  )

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
      .on("postgres_changes", { event: "*", schema: "public", table: "output_versions" }, () =>
        router.refresh()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [listingId, router])

  async function run() {
    if (photoIds.length === 0 || chain.length === 0) return
    setRunning(true)
    setError(null)
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId,
        photoIds,
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
    setPhotoIds([])
    setSampleIds([])
    router.refresh()
  }

  async function sendChat() {
    const text = chatText.trim()
    // interpreter path works one photo at a time
    if (!text || photoIds.length !== 1 || interpreting) return
    const msgs = [...chatMessages, { role: "user" as const, content: text }]
    setChatMessages(msgs)
    setChatText("")
    setChatError(null)
    setInterpreting(true)

    const chips = {
      edit_type: chipEdit || undefined,
      room_type: chipRoom || undefined,
      furniture_style: chipStyle || undefined,
    }
    const res = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs, chips }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setInterpreting(false)
      setChatError(data?.error ?? `request failed (${res.status})`)
      return
    }

    if (data.kind === "question") {
      setChatMessages([...msgs, { role: "assistant", content: data.question }])
      setInterpreting(false)
      return
    }

    // "job" creates one file group; "ideas" creates 4 labeled variants
    const summary =
      data.kind === "ideas"
        ? `Exploring 4 directions: ${(data.directions as { label: string }[])
            .map((d) => d.label)
            .join(" / ")}.`
        : `Running: ${(data.edit_chain as ChainEdit[])
            .map((s) => EDIT_TYPES[s.edit_type]?.label ?? s.edit_type)
            .join(" → ")}.` +
          (data.defaults_noted?.length ? ` Assumed: ${data.defaults_noted.join("; ")}.` : "")
    const convo = [...msgs, { role: "assistant" as const, content: summary }]
    setChatMessages(convo)

    const jobRes = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId,
        photoId: photoIds[0],
        ...(data.kind === "ideas"
          ? {
              kind: "ideas",
              variants: (data.directions as { label: string; edit_chain: ChainEdit[] }[]).map(
                (d) => ({ label: d.label, editChain: d.edit_chain })
              ),
            }
          : { editChain: data.edit_chain }),
        comment: data.comment || undefined,
        commentImperative: data.comment_imperative || undefined,
        sizePreset,
        sampleImageIds: sampleIds.length ? sampleIds : undefined,
        chat: convo,
      }),
    })
    setInterpreting(false)
    if (!jobRes.ok) {
      const jobData = await jobRes.json().catch(() => null)
      setChatError(jobData?.error ?? `job creation failed (${jobRes.status})`)
      return
    }
    setChatMessages([])
    setChipEdit("")
    setChipRoom("")
    setChipStyle("")
    setPhotoIds([])
    setSampleIds([])
    router.refresh()
  }

  async function fetchUrlImages() {
    const url = urlText.trim()
    if (!url || urlBusy) return
    setUrlBusy(true)
    setUrlError(null)
    setUrlImages([])
    const res = await fetch("/api/extract-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
    const data = await res.json().catch(() => null)
    setUrlBusy(false)
    if (!res.ok) {
      setUrlError(data?.error ?? "couldn't read that page — screenshot it and upload instead")
      return
    }
    setUrlImages(data.images ?? [])
  }

  async function importUrlImage(imgUrl: string) {
    if (importedUrls[imgUrl]) return
    const res = await fetch("/api/samples/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imgUrl }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setUrlError(data?.error ?? "import failed")
      return
    }
    setImportedUrls((s) => ({ ...s, [imgUrl]: true }))
    setSampleIds((s) => [...s, data.id])
    router.refresh()
  }

  async function uploadRefs(files: FileList | null) {
    if (!files?.length || uploadingRef) return
    setUploadingRef(true)
    const form = new FormData()
    for (const f of Array.from(files)) form.append("files", f)
    const res = await fetch("/api/samples", { method: "POST", body: form })
    const data = await res.json().catch(() => null)
    setUploadingRef(false)
    if (res.ok && data?.uploaded?.length) {
      setSampleIds((s) => [...s, ...data.uploaded])
      router.refresh()
    }
  }

  const hasFinals = jobs.some((j) =>
    j.file_groups.some((fg) => fg.step_status === "complete" && fg.output_versions.length > 0)
  )

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium">Jobs</h2>
        {hasFinals && (
          <a
            href={`/api/listings/${listingId}/download-all`}
            className="text-sm underline hover:text-foreground"
          >
            Download all finals (zip)
          </a>
        )}
      </div>

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
                  onClick={() => togglePhoto(p.id)}
                  className={`shrink-0 overflow-hidden rounded-md border-2 ${
                    photoIds.includes(p.id) ? "border-primary" : "border-transparent"
                  }`}
                >
                  {p.url && (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                    <img src={p.url} alt="" className="h-16 w-24 object-cover" />
                  )}
                </button>
              ))}
            </div>

            <div className="mt-2 rounded-md border p-3">
              <p className="text-sm font-medium">Describe it</p>
              {chatMessages.length > 0 && (
                <div className="mt-2 grid gap-1.5">
                  {chatMessages.map((m, i) => (
                    <p
                      key={i}
                      className={`max-w-[85%] rounded-md px-2 py-1 text-sm ${
                        m.role === "user"
                          ? "justify-self-end bg-accent text-accent-foreground"
                          : "justify-self-start bg-muted"
                      }`}
                    >
                      {m.content}
                    </p>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={chipEdit}
                  onChange={(e) => setChipEdit(e.target.value)}
                  className="rounded-full border bg-transparent px-2 py-1 text-xs"
                >
                  <option value="">Edit type…</option>
                  {Object.entries(EDIT_TYPES).map(([k, { label }]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={chipRoom}
                  onChange={(e) => setChipRoom(e.target.value)}
                  className="rounded-full border bg-transparent px-2 py-1 text-xs"
                >
                  <option value="">Room type…</option>
                  {ROOM_TYPES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <select
                  value={chipStyle}
                  onChange={(e) => setChipStyle(e.target.value)}
                  className="rounded-full border bg-transparent px-2 py-1 text-xs"
                >
                  <option value="">Style…</option>
                  {Object.entries(FURNITURE_STYLES).map(([k, { label }]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-md border px-2 py-1 text-xs hover:bg-muted">
                  {uploadingRef ? "Uploading…" : "📎 Upload ref"}
                  <input
                    type="file"
                    accept="image/*,.heic,.heif"
                    multiple
                    className="hidden"
                    onChange={(e) => uploadRefs(e.target.files)}
                  />
                </label>
                <input
                  value={urlText}
                  onChange={(e) => setUrlText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchUrlImages()}
                  placeholder="Paste an inspiration URL (Zillow, Pinterest…)"
                  className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-xs"
                />
                <Button size="sm" variant="outline" onClick={fetchUrlImages} disabled={urlBusy || !urlText.trim()}>
                  {urlBusy ? "Reading…" : "Fetch"}
                </Button>
              </div>
              {urlError && <p className="mt-1 text-xs text-destructive">{urlError}</p>}
              {urlImages.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {urlImages.map((img) => (
                    <button
                      key={img}
                      type="button"
                      title={importedUrls[img] ? "added to library" : "add as reference"}
                      onClick={() => importUrlImage(img)}
                      className={`shrink-0 overflow-hidden rounded-md border-2 ${
                        importedUrls[img] ? "border-state-complete" : "border-transparent hover:border-primary/50"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- external candidate images */}
                      <img src={img} alt="" className="h-12 w-16 object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendChat()}
                  placeholder={
                    photoIds.length === 1
                      ? "e.g. this empty living room needs to feel warm modern farmhouse and it's way too dark"
                      : photoIds.length > 1
                        ? "Chat works one photo at a time — keep exactly one selected"
                        : "Select a photo first, then describe what you want"
                  }
                  className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-sm"
                />
                <Button
                  size="sm"
                  onClick={sendChat}
                  disabled={photoIds.length !== 1 || !chatText.trim() || interpreting}
                >
                  {interpreting ? "Thinking…" : "Send"}
                </Button>
              </div>
              {chatError && <p className="mt-2 text-sm text-destructive">{chatError}</p>}
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
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                </div>
                {["ITEM_REMOVAL", "360_ITEM_REMOVAL"].includes(edit.edit_type) && (
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
                {edit.edit_type === "MARKUP_EDIT" &&
                  (photoIds.length !== 1 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Markup works one photo at a time — keep exactly one selected.
                    </p>
                  ) : edit.options.markup_path ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">
                        Markup attached — {Number(edit.options.remove_count ?? 0)} remove,{" "}
                        {Number(edit.options.replace_count ?? 0)} replace. Describe replacements in
                        the comment field.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setOption(i, "markup_path", undefined)
                          setOption(i, "remove_count", undefined)
                          setOption(i, "replace_count", undefined)
                        }}
                      >
                        Redo markup
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2">
                      <MarkupCanvas
                        src={photoById.get(photoIds[0])?.url ?? ""}
                        onAttach={(m) => {
                          setOption(i, "markup_path", m.markup_path)
                          setOption(i, "remove_count", m.remove_count)
                          setOption(i, "replace_count", m.replace_count)
                        }}
                      />
                    </div>
                  ))}
                {edit.edit_type === "IMAGE_ENHANCEMENT" && (
                  // style preset chips (phase 18 ride-along) — recorded on the
                  // job record via the step options, default Natural
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {Object.entries(ENHANCEMENT_STYLES).map(([k, { label }]) => {
                      const on = (edit.options.style_preset ?? "natural") === k
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setOption(i, "style_preset", k)}
                          className={`rounded-full border px-2.5 py-0.5 text-xs ${
                            on
                              ? "border-primary bg-accent text-accent-foreground"
                              : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                )}
                {["IMAGE_ENHANCEMENT", "AERIAL_EDITING", "360_IMAGE_ENHANCEMENT"].includes(
                  edit.edit_type
                ) && (
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
                {["VIRTUAL_STAGING", "360_VIRTUAL_STAGING"].includes(edit.edit_type) && (
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
                {edit.edit_type === "VIRTUAL_RENOVATION" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={String(edit.options.tier)}
                      onChange={(e) => setOption(i, "tier", e.target.value)}
                      className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
                    >
                      {Object.entries(RENOVATION_TIER_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={String(edit.options.changes ?? "")}
                      onChange={(e) => setOption(i, "changes", e.target.value)}
                      placeholder="Describe the finish changes, e.g. white shaker cabinets and quartz counters"
                      className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-sm"
                    />
                  </div>
                )}
                {edit.edit_type === "VIRTUAL_LANDSCAPING" && (
                  <div className="mt-2">
                    <input
                      value={String(edit.options.instructions ?? "")}
                      onChange={(e) => setOption(i, "instructions", e.target.value)}
                      placeholder="Optional extras, e.g. paint the front door navy, add porch furniture"
                      className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
                    />
                  </div>
                )}
                {edit.edit_type === "DAY_TO_DUSK" && (
                  <div className="mt-2">
                    <select
                      value={String(edit.options.preset)}
                      onChange={(e) => setOption(i, "preset", e.target.value)}
                      className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
                    >
                      {Object.entries(LIGHT_PRESETS).map(([k, { label }]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {edit.edit_type === "COLOUR_CHANGE" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={String(edit.options.element ?? "")}
                      onChange={(e) => setOption(i, "element", e.target.value)}
                      placeholder="Element, e.g. the front door"
                      className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-sm"
                    />
                    <input
                      value={String(edit.options.colour ?? "")}
                      onChange={(e) => setOption(i, "colour", e.target.value)}
                      placeholder="New colour, e.g. deep navy blue"
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
                      title={`${s.label ?? ""}${s.use_count >= 2 ? ` — used ${s.use_count}×` : ""}`}
                      onClick={() => toggleSample(s.id)}
                      className={`relative shrink-0 overflow-hidden rounded-md border-2 ${
                        sampleIds.includes(s.id) ? "border-primary" : "border-transparent"
                      }`}
                    >
                      {s.url && (
                        // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                        <img src={s.url} alt={s.label ?? ""} className="h-12 w-16 object-cover" />
                      )}
                      {s.use_count >= 2 && (
                        <span className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
                          ★
                        </span>
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
              <Button
                size="sm"
                onClick={run}
                disabled={photoIds.length === 0 || chain.length === 0 || running}
              >
                {running ? "Submitting…" : photoIds.length > 1 ? `Run ×${photoIds.length}` : "Run"}
              </Button>
            </div>
            {chain.length > 0 && photoIds.length > 0 && (() => {
              // dry-run estimate (CLAUDE.md cost simulation) — refs force gemini
              const sim = simulateCents(
                chain.length,
                photoIds.length,
                // markup edits force gemini (phase 23), same rate path as refs
                sampleIds.length > 0 || chain.some((e) => e.edit_type === "MARKUP_EDIT")
              )
              return (
                <p className="mt-2 text-xs text-muted-foreground">
                  ~{sim.expectedGenerations} generation{sim.expectedGenerations === 1 ? "" : "s"} ·{" "}
                  {sim.providerLabel} ({photoIds.length} photo{photoIds.length > 1 ? "s" : ""} ×{" "}
                  {chain.length} step{chain.length > 1 ? "s" : ""})
                </p>
              )
            })()}
            {chain.some((e) => EDIT_360_TYPES.includes(e.edit_type)) && (
              <p className="mt-2 text-xs text-state-qa">
                Experimental 360 edit — needs an equirectangular (2:1) pano as input; the output
                is flagged for manual seam and pole review.
              </p>
            )}
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </>
        )}
      </div>

      {jobs.length > 0 && (
        <div className="mt-4 grid gap-3">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{job.title}</p>
                <StatePill status={job.status} />
              </div>
              {(() => {
                // job cards show the latest user message as description (CLAUDE.md)
                const lastUser = job.file_groups
                  .flatMap((fg) => fg.chat_messages ?? [])
                  .filter((m) => m.role === "user")
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .at(-1)
                return lastUser ? (
                  <p className="mt-1 text-sm text-muted-foreground">“{lastUser.content}”</p>
                ) : null
              })()}
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
              {job.kind === "ideas" ? (
                // labeled 2x2 grid; each cell opens its own FileGroup page
                // (phase 28 — the promoted-in-place state is gone)
                <div className="stagger mt-3 grid grid-cols-2 gap-2">
                  {job.file_groups.map((fg) => {
                    const v = [...fg.output_versions].sort(
                      (a, b) => b.version_number - a.version_number
                    )[0]
                    return (
                      <Link
                        key={fg.id}
                        href={`/listings/${listingId}/f/${fg.id}`}
                        className="develop-in overflow-hidden rounded-md border-2 border-transparent text-left transition-colors hover:border-primary/50"
                      >
                        {v?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                          <img src={v.url} alt="" className="aspect-video w-full object-cover" />
                        ) : (
                          <div
                            className={`flex aspect-video w-full items-center justify-center bg-muted text-xs text-muted-foreground ${
                              fg.step_status === "failed" ? "" : "sweep"
                            }`}
                          >
                            {fg.step_status === "failed" ? "failed" : "generating…"}
                          </div>
                        )}
                        <p className="px-1.5 py-1 text-xs font-medium">{fg.comment}</p>
                      </Link>
                    )
                  })}
                </div>
              ) : (
                // compact card rows — each links to the FileGroup workspace where
                // before/after, versions, rework, download etc. now live (phase 28)
                job.file_groups.map((fg) => {
                  const latest = [...fg.output_versions].sort(
                    (a, b) => b.version_number - a.version_number
                  )[0]
                  const before = photoById.get(fg.primary_photo_id)
                  const thumb = latest?.url ?? before?.url ?? null
                  const summary = fg.edit_chain
                    .map((s) => EDIT_TYPES[s.edit_type]?.label ?? s.edit_type)
                    .join(" → ")
                  const doneSteps = fg.current_step + (fg.step_status === "complete" ? 1 : 0)
                  const stripeColor =
                    fg.step_status === "failed"
                      ? "bg-state-failed"
                      : fg.step_status === "complete"
                        ? "bg-state-complete"
                        : "bg-state-running"
                  return (
                    <Link
                      key={fg.id}
                      href={`/listings/${listingId}/f/${fg.id}`}
                      className="mt-3 flex items-center gap-3 rounded-md border p-2 transition-colors hover:bg-muted"
                    >
                      <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
                          <img src={thumb} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div
                            className={`flex h-full w-full items-center justify-center text-[10px] text-muted-foreground ${
                              fg.step_status === "failed" ? "" : "sweep"
                            }`}
                          >
                            {fg.step_status === "failed" ? "failed" : "…"}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">{summary}</p>
                          <StatePill status={fg.step_status} />
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${stripeColor}`}
                            style={{
                              width: `${Math.round((doneSteps / Math.max(fg.edit_chain.length, 1)) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </Link>
                  )
                })
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
