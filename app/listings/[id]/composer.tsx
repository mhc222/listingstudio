"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { ROOM_TYPES } from "@/lib/roomTypes"
import { FURNITURE_STYLES } from "@/lib/prompts"
import { simulateCents } from "@/lib/simulate"
import { ChainStepEditor } from "./chain-step-editor"
import { EDIT_TYPES, EDIT_360_TYPES, SIZE_PRESETS, type ChainEdit } from "./edit-types"
import type { PhotoRow } from "./photo-grid"
import type { SampleRow } from "./job-feed"

// One composer (phase 30): chat interpret MATERIALIZES an editable chain (or 4
// labeled ideas) instead of blind-firing a job; the manual builder is demoted
// to a <details>; a single Run posts the possibly-edited chain + persisted chat.
type IdeaDir = { label: string; edit_chain: ChainEdit[] }
type InterpreterResponse = {
  kind: "question" | "ideas" | "job"
  question?: string
  directions?: IdeaDir[]
  edit_chain?: ChainEdit[]
  comment?: string
  comment_imperative?: string
  defaults_noted?: string[]
  error?: string
}
// a chain whose per-step options may be absent (JobRow.edit_chain / stored default)
type ChainLike = { edit_type: string; options?: Record<string, unknown> }

const PRIMARY_TASKS = [
  { editType: "IMAGE_ENHANCEMENT", label: "Enhance", description: "Balance light and finish" },
  { editType: "VIRTUAL_STAGING", label: "Stage", description: "Furnish an empty room" },
  { editType: "DAY_TO_DUSK", label: "Dusk", description: "Create an evening hero" },
  { editType: "ITEM_REMOVAL", label: "Remove", description: "Clear objects or clutter" },
  { editType: "VIRTUAL_RENOVATION", label: "Renovate", description: "Update finishes and fixtures" },
  { editType: "COLOUR_CHANGE", label: "Change color", description: "Repaint a chosen surface" },
] as const

const TASK_HEADINGS: Record<string, string> = {
  IMAGE_ENHANCEMENT: "Enhance this photo",
  VIRTUAL_STAGING: "Stage this room",
  DAY_TO_DUSK: "Create a dusk photo",
  ITEM_REMOVAL: "Remove items",
  VIRTUAL_RENOVATION: "Renovate this space",
  COLOUR_CHANGE: "Change a color",
}

export function Composer({
  listingId,
  photos,
  samples,
  selectedIds,
  lastChain,
  contextLabel = "Photo edit",
  initialRoomType,
  onSubmittingChange,
  additionalViews = [],
  onToggleAdditionalView,
}: {
  listingId: string
  photos: PhotoRow[]
  samples: SampleRow[]
  // selection lives in the shared grid/tray (phase 29); the composer reads it
  // and clears it on a successful run
  selectedIds: string[]
  // newest job's batchable chain, derived by the workspace (phase 31) — the
  // "apply last chain" accelerator for the repeat weekly workflow. Loose options
  // (JobRow's edit_chain has them optional) — applyChain fills defaults anyway.
  lastChain: ChainLike[] | null
  contextLabel?: string
  initialRoomType?: string | null
  onSubmittingChange?: (submitting: boolean) => void
  additionalViews?: { id: string; url: string | null; label: string; sameRoom: boolean }[]
  onToggleAdditionalView?: (id: string) => void
}) {
  const router = useRouter()
  // batch (phase 10): multi-select; the chat path requires exactly one photo.
  const photoIds = selectedIds
  const [chain, setChain] = useState<ChainEdit[]>([])
  const [ideas, setIdeas] = useState<IdeaDir[] | null>(null)
  const [comment, setComment] = useState("")
  // interpreter's imperative-normalized comment (phase 24) — set when a chain
  // is materialized from chat, cleared on a fresh manual draft
  const [commentImperative, setCommentImperative] = useState("")
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

  const photoById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])

  // phase 31: per-listing default chain in localStorage (single-user, no
  // migration); read once on mount (SSR-safe — localStorage is client-only)
  const defaultKey = `ls:defaultChain:${listingId}`
  const [defaultChain, setDefaultChain] = useState<ChainEdit[] | null>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(defaultKey)
      if (raw) setDefaultChain(JSON.parse(raw) as ChainEdit[])
    } catch {
      // corrupt/blocked storage — no default, no crash
    }
  }, [defaultKey])

  // apply a saved/derived chain into the editable draft (deep-cloned over
  // catalog defaults so option edits never mutate the source)
  function applyChain(next: ChainLike[]) {
    setIdeas(null)
    setChain(
      next.map((s) => ({
        edit_type: s.edit_type,
        options: { ...(EDIT_TYPES[s.edit_type]?.defaults ?? {}), ...(s.options ?? {}) },
      }))
    )
  }

  function saveDefault() {
    if (chain.length === 0) return
    try {
      localStorage.setItem(defaultKey, JSON.stringify(chain))
      setDefaultChain(chain)
    } catch {
      // blocked storage — best-effort, no default persisted
    }
  }

  const chainSummary = (c: ChainLike[]) =>
    c.map((s) => EDIT_TYPES[s.edit_type]?.label ?? s.edit_type).join(" → ")

  function toggleSample(id: string) {
    setSampleIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function addEdit(editType: string) {
    setIdeas(null)
    setChain((c) => [...c, { edit_type: editType, options: { ...EDIT_TYPES[editType].defaults } }])
  }

  function chooseTask(editType: string) {
    const defaults = { ...EDIT_TYPES[editType].defaults }
    if (
      editType === "VIRTUAL_STAGING" &&
      initialRoomType &&
      ROOM_TYPES.some((room) => room.value === initialRoomType)
    ) {
      defaults.room_type = initialRoomType
    }
    setIdeas(null)
    setChain([{ edit_type: editType, options: defaults }])
    setError(null)
  }

  function removeEdit(index: number) {
    setChain((c) => c.filter((_, i) => i !== index))
  }

  function setOption(index: number, key: string, value: unknown) {
    setChain((c) =>
      c.map((e, i) => (i === index ? { ...e, options: { ...e.options, [key]: value } } : e))
    )
  }

  async function run() {
    const hasIdeas = !!ideas && ideas.length === 4
    if (photoIds.length === 0 || (chain.length === 0 && !hasIdeas)) return
    if (hasIdeas && photoIds.length !== 1) {
      setError("Ideas explore one photo — keep exactly one selected.")
      return
    }
    setRunning(true)
    onSubmittingChange?.(true)
    setError(null)
    const chat = chatMessages.length ? chatMessages : undefined
    const commonBody = {
      listingId,
      comment: comment.trim() || undefined,
      commentImperative: commentImperative.trim() || undefined,
      sizePreset,
      sampleImageIds: sampleIds.length ? sampleIds : undefined,
      chat,
    }
    const body = hasIdeas
      ? {
          ...commonBody,
          photoId: photoIds[0],
          kind: "ideas",
          variants: ideas!.map((d) => ({ label: d.label, editChain: d.edit_chain })),
        }
      : { ...commonBody, photoIds, editChain: chain }
    let navigated = false
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? `Could not start the edit (${res.status}). Please try again.`)
        return
      }
      const firstFileGroupId = data?.fileGroupIds?.[0]
      if (!firstFileGroupId) {
        setError("The edit started, but its result page could not be opened. Find it in Activity.")
        return
      }
      navigated = true
      router.push(`/listings/${listingId}/f/${firstFileGroupId}`)
      router.refresh()
      // Keep the dialog locked until navigation unmounts it. The draft remains
      // intact if navigation itself fails, and Activity can still recover it.
      return
    } catch {
      setError("The edit could not be started because the connection was interrupted. Try again.")
    } finally {
      // Successful navigation unmounts this component. On failure, release the
      // shell so the user can retry or close without losing the draft.
      if (!navigated) {
        setRunning(false)
        onSubmittingChange?.(false)
      }
    }
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
    let data: InterpreterResponse | null = null
    try {
      const res = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, chips }),
      })
      data = await res.json().catch(() => null)
      if (!res.ok) {
        setChatError(data?.error ?? `Could not understand the edit (${res.status}). Try again.`)
        return
      }
    } catch {
      setChatError("The connection was interrupted. Your description is still here—try again.")
      return
    } finally {
      setInterpreting(false)
    }

    if (!data) {
      setChatError("The studio returned an empty response. Try again.")
      return
    }
    if (data.kind === "question") {
      setChatMessages([...msgs, { role: "assistant", content: data.question ?? "What should we adjust?" }])
      return
    }

    // MATERIALIZE — chat no longer blind-fires the job (phase 30). The chain
    // becomes editable state; a single Run posts it + this conversation.
    if (data.kind === "ideas") {
      setIdeas(
        (data.directions ?? []).map((d) => ({
          label: d.label,
          edit_chain: d.edit_chain,
        }))
      )
      setChain([])
      setComment(data.comment || "")
      setCommentImperative("")
      setChatMessages([
        ...msgs,
        {
          role: "assistant",
        content: `Preparing 4 directions: ${(data.directions ?? [])
            .map((d) => d.label)
            .join(" / ")}. Review them, then start the edit.`,
        },
      ])
      return
    }

    // kind === "job": one editable chain, options merged over catalog defaults
    // so every option form has the keys it reads
    setIdeas(null)
    setChain(
      (data.edit_chain ?? []).map((s) => ({
        edit_type: s.edit_type,
        options: { ...(EDIT_TYPES[s.edit_type]?.defaults ?? {}), ...(s.options ?? {}) },
      }))
    )
    setComment(data.comment || "")
    setCommentImperative(data.comment_imperative || "")
    const noted = data.defaults_noted?.length ? ` Assumed: ${data.defaults_noted.join("; ")}.` : ""
    setChatMessages([
      ...msgs,
      {
        role: "assistant",
        content:
          `Ready to edit: ${(data.edit_chain ?? [])
            .map((s) => EDIT_TYPES[s.edit_type]?.label ?? s.edit_type)
            .join(" → ")}. Review any details below, then start the edit.` + noted,
      },
    ])
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

  const canRun = photoIds.length > 0 && (chain.length > 0 || (!!ideas && ideas.length === 4))

  return (
    <section>
      <header className="mb-5 border-b border-border pb-4">
        <p className="font-ui text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
          {contextLabel}
        </p>
        <h2 className="mt-1 font-serif text-3xl">
          {chain.length === 1
            ? TASK_HEADINGS[chain[0].edit_type] ?? EDIT_TYPES[chain[0].edit_type]?.label
            : chain.length > 1
              ? "Review this edit"
              : "What should we do?"}
        </h2>
        {chain.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setChain([])
              setIdeas(null)
            }}
            className="mt-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Choose a different task
          </button>
        )}
      </header>
      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Upload photos first.</p>
      ) : (
        <>
          {/* selection lives in the grid above (phase 29) — the composer just
              reflects the current arity */}
          <p className="mb-4 text-xs text-muted-foreground">
            {photoIds.length === 0
              ? "Select photos above — one to describe/markup, several to batch."
              : photoIds.length === 1
                ? "Editing one photo"
                : `Applying the same settings to ${photoIds.length} photos`}
          </p>

          {chain.length === 0 && !ideas && (
            <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border">
              {PRIMARY_TASKS.map((task) => (
                <button
                  key={task.editType}
                  type="button"
                  onClick={() => chooseTask(task.editType)}
                  className="min-h-20 bg-card px-3 py-3 text-left transition-colors hover:bg-accent focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block font-ui text-sm font-semibold">{task.label}</span>
                  <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                    {task.description}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => document.getElementById("advanced-edit-catalog")?.setAttribute("open", "")}
                className="col-span-2 min-h-12 bg-card px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                More edits <span aria-hidden="true">→</span>
              </button>
            </div>
          )}

          {/* phase 31 accelerators: reuse a chain without rebuilding it */}
          {(lastChain || defaultChain || chain.length > 0) && (
            <details className="mb-4 border-b border-border pb-3">
              <summary className="cursor-pointer font-ui text-xs uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
                Saved edits
              </summary>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {lastChain && (
                  <button
                    type="button"
                    onClick={() => applyChain(lastChain)}
                    title={chainSummary(lastChain)}
                    className="border border-border px-2 py-1 text-xs hover:bg-muted"
                  >
                    ↻ Apply last edit
                  </button>
                )}
                {defaultChain && (
                  <button
                    type="button"
                    onClick={() => applyChain(defaultChain)}
                    title={chainSummary(defaultChain)}
                    className="border border-border px-2 py-1 text-xs hover:bg-muted"
                  >
                    ★ Apply listing default
                  </button>
                )}
                {chain.length > 0 && (
                  <button
                    type="button"
                    onClick={saveDefault}
                    className="border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Save current edit as default
                  </button>
                )}
              </div>
            </details>
          )}

          {(chain.length === 0 || chatMessages.length > 0) && <div className="mt-4">
            <label htmlFor="describe-edit" className="font-ui text-xs font-semibold uppercase tracking-[0.12em]">
              {chain.length === 0 ? "Or describe the result" : "Refine the setup"}
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Use plain language. The studio will turn it into editable steps before anything starts.
            </p>
            {chatMessages.length > 0 && (
              <div className="mt-3 grid gap-1.5">
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
            {/* the conversation is the hero — one prominent input, not a wall of
                dropdowns (Matt, 2026-08-31). Room/style/refs live under a quiet
                "Add detail" toggle; the interpreter infers them from language. */}
            <div className="mt-3 flex items-center gap-2">
              <input
                id="describe-edit"
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
                className="min-w-0 flex-1 border border-input bg-card px-3 py-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <Button
                onClick={sendChat}
                disabled={photoIds.length !== 1 || !chatText.trim() || interpreting}
              >
                {interpreting ? "Building…" : "Build edit"}
              </Button>
            </div>
            {chatError && <p className="mt-2 text-sm text-destructive">{chatError}</p>}

            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Add detail — room, style, references
              </summary>
              <div className="mt-2 grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={chipEdit} onChange={(e) => setChipEdit(e.target.value)} className="w-auto text-xs">
                    <option value="">Edit type…</option>
                    {Object.entries(EDIT_TYPES).map(([k, { label }]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </Select>
                  <Select value={chipRoom} onChange={(e) => setChipRoom(e.target.value)} className="w-auto text-xs">
                    <option value="">Room type…</option>
                    {ROOM_TYPES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                  <Select value={chipStyle} onChange={(e) => setChipStyle(e.target.value)} className="w-auto text-xs">
                    <option value="">Style…</option>
                    {Object.entries(FURNITURE_STYLES).map(([k, { label }]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                {urlError && <p className="text-xs text-destructive">{urlError}</p>}
                {urlImages.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
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
              </div>
            </details>
          </div>}

          {/* materialized ideas: 4 labeled mini-chains, one Run */}
          {ideas && (
            <div className="mt-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">4 directions to explore</p>
                <button
                  type="button"
                  onClick={() => setIdeas(null)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Clear
                </button>
              </div>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {ideas.map((d, i) => (
                  <div key={i} className="rounded-md border px-2 py-1.5 text-xs">
                    <p className="font-medium">{d.label}</p>
                    <p className="text-muted-foreground">
                      {d.edit_chain
                        .map((s) => EDIT_TYPES[s.edit_type]?.label ?? s.edit_type)
                        .join(" → ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* materialized / manually-built chain */}
          <ChainStepEditor
            chain={chain}
            photoIds={photoIds}
            photoById={photoById}
            onOption={setOption}
            onRemove={removeEdit}
          />

          {chain.length > 0 && additionalViews.length > 0 && onToggleAdditionalView && (
            <details className="mt-4 border-t border-border pt-3">
              <summary className="cursor-pointer font-ui text-xs uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
                Apply these settings to another view
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                Each photo is edited separately with the same settings. Same-room views are shown first.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {additionalViews.map((view) => {
                  const selected = photoIds.includes(view.id)
                  return (
                    <button
                      key={view.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onToggleAdditionalView(view.id)}
                      className={`relative overflow-hidden border-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        selected ? "border-primary" : "border-transparent ring-1 ring-border"
                      }`}
                    >
                      {view.url && (
                        // eslint-disable-next-line @next/next/no-img-element -- signed listing-photo URL
                        <img src={view.url} alt="" className="aspect-[4/3] w-full object-cover" />
                      )}
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-1 text-[10px] text-white">
                        {selected ? "✓ " : ""}{view.sameRoom ? "Same room" : view.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </details>
          )}

          {/* The ordered chain is the moat, but it is advanced vocabulary. */}
          <details id="advanced-edit-catalog" className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer font-ui text-xs uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
              Advanced · edit order and more tools
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select
                value=""
                onChange={(e) => e.target.value && addEdit(e.target.value)}
                className="w-auto"
              >
                <option value="">+ Add edit…</option>
                {Object.entries(EDIT_TYPES).map(([k, { label }]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </details>

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

          {chain.length > 0 && (
            <div className="mt-4">
              <label htmlFor="edit-notes" className="font-ui text-xs font-semibold uppercase tracking-[0.12em]">
                Anything else? <span className="font-normal normal-case tracking-normal text-muted-foreground">Optional</span>
              </label>
              <input
                id="edit-notes"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="e.g. keep the fireplace as-is and use warm neutral fabrics"
                className="mt-2 w-full border border-input bg-card px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
          )}
          <div className="sticky bottom-0 z-10 -mx-4 mt-5 border-t border-border bg-background/95 px-4 py-4 backdrop-blur sm:mx-0 sm:px-0">
            <div className="flex items-center gap-3">
              <details className="relative">
                <summary className="cursor-pointer list-none text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  Output size
                </summary>
                <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-20 w-44 border border-border bg-popover p-2 shadow-lg">
                  <Select
                    aria-label="Output size"
                    value={sizePreset}
                    onChange={(e) => setSizePreset(e.target.value)}
                  >
                    {Object.entries(SIZE_PRESETS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
              </details>
              <Button className="ml-auto min-w-36" size="lg" onClick={run} disabled={!canRun || running}>
                {running
                  ? "Starting edit…"
                  : photoIds.length > 1 && !ideas
                    ? `Start edit on ${photoIds.length}`
                    : "Start edit"}
              </Button>
            </div>
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
                About {sim.expectedGenerations} image pass{sim.expectedGenerations === 1 ? "" : "es"} ·{" "}
                {photoIds.length} photo{photoIds.length > 1 ? "s" : ""} × {chain.length} edit{chain.length > 1 ? "s" : ""}
              </p>
            )
          })()}
          {ideas && (
            <p className="mt-2 text-xs text-muted-foreground">
              ~4 generations · one ideas run on the selected photo.
            </p>
          )}
          {chain.some((e) => EDIT_360_TYPES.includes(e.edit_type)) && (
            <p className="mt-2 text-xs text-state-qa">
              Experimental 360 edit — needs an equirectangular (2:1) pano as input; the output
              is flagged for manual seam and pole review.
            </p>
          )}
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </>
      )}
    </section>
  )
}
