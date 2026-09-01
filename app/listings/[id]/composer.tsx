"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Armchair, Eraser, Hammer, MoreHorizontal, Moon, Paintbrush, Plus, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Disclosure } from "@/components/ui/disclosure"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select } from "@/components/ui/select"
import { ROOM_TYPES } from "@/lib/roomTypes"
import { FURNITURE_STYLES } from "@/lib/prompts"
import { simulateCents } from "@/lib/simulate"
import {
  buildBatchScope,
  withConfirmedRoomStaging,
  type ScopePhoto,
  type SelectionMethod,
} from "@/lib/batch-scope"
import { ChainStepEditor } from "./chain-step-editor"
import { EDIT_TYPES, EDIT_360_TYPES, SIZE_PRESETS, type ChainEdit } from "./edit-types"
import type { PhotoRow } from "./photo-grid"
import type { SampleRow } from "./job-feed"
import type { SameRoomGroupRow } from "./room-organization"

// One composer (phase 30): chat interpret MATERIALIZES an editable chain (or 4
// labeled ideas) instead of blind-firing a job; advanced choices use the shared
// disclosure language; a single Run posts the possibly-edited chain + persisted chat.
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
  { editType: "IMAGE_ENHANCEMENT", label: "Enhance", description: "Balance light and finish", icon: Sparkles },
  { editType: "VIRTUAL_STAGING", label: "Stage", description: "Furnish an empty room", icon: Armchair },
  { editType: "DAY_TO_DUSK", label: "Dusk", description: "Create an evening hero", icon: Moon },
  { editType: "ITEM_REMOVAL", label: "Remove", description: "Clear objects or clutter", icon: Eraser },
  { editType: "VIRTUAL_RENOVATION", label: "Renovate", description: "Update finishes and fixtures", icon: Hammer },
  { editType: "COLOUR_CHANGE", label: "Change color", description: "Repaint a chosen surface", icon: Paintbrush },
] as const

const PRIMARY_TASK_TYPES = new Set<string>(PRIMARY_TASKS.map((task) => task.editType))

const TASK_HEADINGS: Record<string, string> = {
  IMAGE_ENHANCEMENT: "Enhance this photo",
  VIRTUAL_STAGING: "Stage this room",
  DAY_TO_DUSK: "Create a dusk photo",
  ITEM_REMOVAL: "Remove items",
  VIRTUAL_RENOVATION: "Renovate this space",
  COLOUR_CHANGE: "Change a color",
}

function TaskModeRail({ activeTask, onSelect }: { activeTask?: string; onSelect: (editType: string) => void }) {
  const rail = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const [indicator, setIndicator] = useState({ left: 0, width: 0, visible: false })
  const [moreOpen, setMoreOpen] = useState(false)
  const activeKey = activeTask && PRIMARY_TASK_TYPES.has(activeTask) ? activeTask : activeTask ? "__more" : undefined

  useLayoutEffect(() => {
    function measure() {
      const button = activeKey ? buttons.current.get(activeKey) : undefined
      if (!button) return setIndicator((current) => ({ ...current, visible: false }))
      setIndicator({ left: button.offsetLeft, width: button.offsetWidth, visible: true })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (rail.current) observer.observe(rail.current)
    return () => observer.disconnect()
  }, [activeKey])

  function setButton(key: string, node: HTMLButtonElement | null) {
    if (node) buttons.current.set(key, node)
    else buttons.current.delete(key)
  }

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Edit task">
      <div ref={rail} className="relative flex min-w-max items-center gap-1 rounded-xl bg-muted/72 p-1">
        <span
          aria-hidden="true"
          className="absolute inset-y-1 rounded-lg bg-card shadow-sm transition-[transform,width,opacity] duration-200 ease-[var(--ease-fluid)]"
          style={{
            width: indicator.width,
            opacity: indicator.visible ? 1 : 0,
            transform: `translateX(${indicator.left - 4}px)`,
          }}
        />
        {PRIMARY_TASKS.map((task) => {
          const selected = activeTask === task.editType
          return (
            <button
              key={task.editType}
              ref={(node) => setButton(task.editType, node)}
              type="button"
              aria-pressed={selected}
              title={task.description}
              onClick={() => onSelect(task.editType)}
              className={`ls-pressable relative z-10 flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${selected ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <task.icon aria-hidden="true" className="size-3.5" />
              {task.label}
            </button>
          )
        })}
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <button
              ref={(node) => setButton("__more", node)}
              type="button"
              aria-pressed={Boolean(activeTask && !PRIMARY_TASK_TYPES.has(activeTask))}
              className={`ls-pressable relative z-10 flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${activeTask && !PRIMARY_TASK_TYPES.has(activeTask) ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <MoreHorizontal aria-hidden="true" className="size-4" /> More
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="end">
            <p className="px-2 pb-1 pt-1 text-xs font-semibold text-muted-foreground">More edit tools</p>
            <div className="grid gap-0.5">
              {Object.entries(EDIT_TYPES)
                .filter(([editType]) => !PRIMARY_TASK_TYPES.has(editType))
                .map(([editType, { label }]) => (
                  <button
                    key={editType}
                    type="button"
                    onClick={() => {
                      onSelect(editType)
                      setMoreOpen(false)
                    }}
                    className="ls-pressable min-h-10 rounded-lg px-2.5 text-left text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/35"
                  >
                    {label}
                  </button>
                ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

export function Composer({
  listingId,
  photos,
  samples,
  selectedIds,
  lastChain,
  contextLabel = "Photo edit",
  initialRoomType,
  rooms,
  sameRoomGroups,
  selectionMethod = "manual",
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
  rooms: { id: string; name: string; room_type: string }[]
  sameRoomGroups: SameRoomGroupRow[]
  selectionMethod?: SelectionMethod
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
  const taskDrafts = useRef<Record<string, ChainEdit>>({})
  const pendingRequest = useRef<{ scopeKey: string; requestId: string } | null>(null)
  const [useConfirmedRoomSettings, setUseConfirmedRoomSettings] = useState(false)

  // interpreter chat (phase 7): conversation is ephemeral until a job is
  // created, then persisted to chat_messages on the new file group
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([])
  const [chatText, setChatText] = useState("")
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
  const scopePhotos = useMemo<ScopePhoto[]>(() => {
    const roomById = new Map(rooms.map((room) => [room.id, room]))
    const groupByPhoto = new Map(
      sameRoomGroups.flatMap((group) => group.memberPhotoIds.map((photoId) => [photoId, group.id] as const))
    )
    return selectedIds.flatMap((id) => {
      const photo = photoById.get(id)
      if (!photo) return []
      const room = photo.room_id ? roomById.get(photo.room_id) : null
      return [{
        id,
        roomId: photo.room_id,
        roomType: room?.room_type ?? null,
        roomName: room?.name ?? null,
        sameRoomGroupId: groupByPhoto.get(id) ?? null,
        photoRole: photo.photo_role === "hdr_merged" ? "hdr_merged" : "source",
        hdrGroupId: photo.hdr_group_id ?? null,
      }]
    })
  }, [photoById, rooms, sameRoomGroups, selectedIds])
  const hasStaging = chain.some((step) => step.edit_type === "VIRTUAL_STAGING")
  const explicitTargets = hasStaging && useConfirmedRoomSettings
    ? withConfirmedRoomStaging(photoIds, scopePhotos, chain)
    : undefined
  const batchScope = chain.length > 0
    ? buildBatchScope({
        requestedPhotoIds: photoIds,
        photos: scopePhotos,
        commonChain: chain,
        explicitTargets,
        selectionMethod,
        outputSize: sizePreset,
      })
    : null
  const batchScopeError = photoIds.length > 1 && batchScope && !batchScope.ok ? batchScope.error : null
  const canApplyConfirmedRooms = photoIds.length > 1 && hasStaging && scopePhotos.every((photo) => photo.roomId && photo.roomType)

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
    if (chain[0]?.edit_type === editType) return
    if (chain[0]) {
      taskDrafts.current[chain[0].edit_type] = {
        edit_type: chain[0].edit_type,
        options: { ...chain[0].options },
      }
    }
    const saved = taskDrafts.current[editType]
    const defaults = { ...EDIT_TYPES[editType].defaults }
    if (
      !saved &&
      editType === "VIRTUAL_STAGING" &&
      initialRoomType &&
      ROOM_TYPES.some((room) => room.value === initialRoomType)
    ) {
      defaults.room_type = initialRoomType
    }
    setIdeas(null)
    setChain(saved ? [{ edit_type: editType, options: { ...saved.options } }] : [{ edit_type: editType, options: defaults }])
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
    if (!hasIdeas && batchScopeError) {
      setError(batchScopeError)
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
    const scopeKey = JSON.stringify({ photoIds, chain, explicitTargets, sizePreset, selectionMethod, ideas })
    if (!pendingRequest.current || pendingRequest.current.scopeKey !== scopeKey) {
      pendingRequest.current = { scopeKey, requestId: crypto.randomUUID() }
    }
    const body = hasIdeas
      ? {
          ...commonBody,
          photoId: photoIds[0],
          kind: "ideas",
          variants: ideas!.map((d) => ({ label: d.label, editChain: d.edit_chain })),
          targetRequestId: pendingRequest.current.requestId,
          selectionMethod: "single",
        }
      : {
          ...commonBody,
          photoIds,
          editChain: chain,
          targets: explicitTargets,
          targetRequestId: pendingRequest.current.requestId,
          selectionMethod,
        }
    let navigated = false
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      pendingRequest.current = null
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

  const canRun = photoIds.length > 0 && (chain.length > 0 || (!!ideas && ideas.length === 4)) && !batchScopeError

  return (
    <section>
      <header className="mb-5">
        <p className="ls-section-label text-muted-foreground">
          {contextLabel}
        </p>
        <h2 className="mt-1.5 text-[1.75rem] font-semibold tracking-[-0.035em]">
          {chain.length === 1
            ? TASK_HEADINGS[chain[0].edit_type] ?? EDIT_TYPES[chain[0].edit_type]?.label
            : chain.length > 1
              ? "Review this edit"
              : "What should we do?"}
        </h2>
      </header>
      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Upload photos first.</p>
      ) : (
        <>
          {/* selection lives in the grid above (phase 29) — the composer just
              reflects the current arity */}
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            {photoIds.length === 0
              ? "Select photos above — one to describe/markup, several to batch."
              : photoIds.length === 1
                ? "Editing one photo"
                : `Applying the same settings to ${photoIds.length} photos`}
          </p>
          {photoIds.length > 1 && (
            <div className="mb-4 rounded-xl border border-border/70 bg-card/65 p-3" aria-label="Exact batch scope">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Exact batch scope</p>
                <span className="rounded-full bg-accent px-2.5 py-1 text-[0.68rem] font-semibold text-accent-foreground">
                  {photoIds.length} logical photos
                </span>
              </div>
              <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-[5.5rem_1fr]">
                <dt className="font-medium text-muted-foreground">Rooms</dt>
                <dd>
                  {(() => {
                    const counts = new Map<string, number>()
                    for (const photo of scopePhotos) {
                      const label = photo.roomName ?? "Untagged"
                      counts.set(label, (counts.get(label) ?? 0) + 1)
                    }
                    return Array.from(counts).map(([label, count]) => `${label} (${count})`).join(", ")
                  })()}
                </dd>
                <dt className="font-medium text-muted-foreground">View groups</dt>
                <dd>
                  {(() => {
                    const ids = Array.from(new Set(scopePhotos.flatMap((photo) => photo.sameRoomGroupId ? [photo.sameRoomGroupId] : [])))
                    return ids.length
                      ? ids.map((id) => sameRoomGroups.find((group) => group.id === id)?.name ?? "Same-room group").join(", ")
                      : "No same-room group"
                  })()}
                </dd>
                <dt className="font-medium text-muted-foreground">Edits</dt>
                <dd>{chain.length ? chainSummary(chain) : "Choose an outcome"}</dd>
                <dt className="font-medium text-muted-foreground">Output</dt>
                <dd>{SIZE_PRESETS[sizePreset] ?? SIZE_PRESETS.original}</dd>
                <dt className="font-medium text-muted-foreground">Estimate</dt>
                <dd>
                  {batchScope?.ok ? batchScope.snapshot.estimatedGenerationCount : photoIds.length * chain.length} image pass{(batchScope?.ok ? batchScope.snapshot.estimatedGenerationCount : photoIds.length * chain.length) === 1 ? "" : "es"}
                </dd>
              </dl>
              {batchScopeError && (
                <div className="mt-3 rounded-lg bg-destructive/8 p-2.5 text-xs text-destructive">
                  <p>{batchScopeError}</p>
                  {canApplyConfirmedRooms && (
                    <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setUseConfirmedRoomSettings(true)}>
                      Use each photo&apos;s confirmed room settings
                    </Button>
                  )}
                </div>
              )}
              {hasStaging && useConfirmedRoomSettings && !batchScopeError && (
                <p className="mt-3 text-xs text-emerald-700">
                  Each target will use its own confirmed room type. The saved preset remains unchanged.
                </p>
              )}
              <p className="mt-2 text-[0.68rem] leading-relaxed text-muted-foreground">
                Only these displayed targets will run. Nothing selected never expands to the whole listing.
              </p>
            </div>
          )}
          <TaskModeRail activeTask={chain[0]?.edit_type} onSelect={chooseTask} />
          {chain.length === 0 && !ideas && (
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              Choose an outcome above, or describe the result in your own words.
            </p>
          )}

          {/* phase 31 accelerators: reuse a chain without rebuilding it */}
          {(lastChain || defaultChain || chain.length > 0) && (
            <Disclosure
              className="mb-4 mt-3"
              summary="Saved edits"
              triggerClassName="px-1 text-xs font-semibold"
              contentClassName="px-1"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {lastChain && (
                  <button
                    type="button"
                    onClick={() => applyChain(lastChain)}
                    title={chainSummary(lastChain)}
                    className="ls-pressable rounded-full bg-muted px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    ↻ Apply last edit
                  </button>
                )}
                {defaultChain && (
                  <button
                    type="button"
                    onClick={() => applyChain(defaultChain)}
                    title={chainSummary(defaultChain)}
                    className="ls-pressable rounded-full bg-muted px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    ★ Apply listing default
                  </button>
                )}
                {chain.length > 0 && (
                  <button
                    type="button"
                    onClick={saveDefault}
                    className="ls-pressable rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Save current edit as default
                  </button>
                )}
              </div>
            </Disclosure>
          )}

          {(chain.length === 0 || chatMessages.length > 0) && <div className="mt-4">
            <label htmlFor="describe-edit" className="text-xs font-semibold">
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
              <Input
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
                className="min-w-0 flex-1"
              />
              <Button
                onClick={sendChat}
                disabled={photoIds.length !== 1 || !chatText.trim() || interpreting}
              >
                {interpreting ? "Building…" : "Build edit"}
              </Button>
            </div>
            {chatError && <p className="mt-2 text-sm text-destructive">{chatError}</p>}

            <Disclosure
              className="mt-3"
              summary="Add detail — room, style, references"
              triggerClassName="px-1 text-xs"
              contentClassName="px-1"
            >
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
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
                  <label className="ls-pressable cursor-pointer rounded-lg bg-muted px-2.5 py-2 text-xs font-medium hover:bg-accent">
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
                    className="min-w-0 flex-1 rounded-lg border border-border/70 bg-card px-2.5 py-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
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
            </Disclosure>
          </div>}

          {/* materialized ideas: 4 labeled mini-chains, one Run */}
          {ideas && (
            <div className="mt-3 rounded-xl bg-card/65 p-3">
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
                  <div key={i} className="rounded-lg bg-muted/65 px-2.5 py-2 text-xs">
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
          <div key={chain[0]?.edit_type ?? "no-task"} className="ls-mode-panel">
            <ChainStepEditor
              chain={chain}
              photoIds={photoIds}
              photoById={photoById}
              onOption={setOption}
              onRemove={removeEdit}
            />
          </div>

          {chain.length > 0 && additionalViews.length > 0 && onToggleAdditionalView && (
            <Disclosure
              className="mt-4"
              summary="Apply these settings to another view"
              triggerClassName="px-1 text-xs font-semibold"
              contentClassName="px-1"
            >
              <p className="text-xs text-muted-foreground">
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
            </Disclosure>
          )}

          {/* The ordered chain is powerful, but only appears after the first
              outcome has been chosen. There is no second empty-state picker. */}
          {chain.length > 0 && (
            <Disclosure
              className="mt-4"
              summary={<span className="flex items-center gap-2"><Plus aria-hidden="true" className="size-3.5" />Add another edit</span>}
              triggerClassName="px-1 text-xs font-semibold"
              contentClassName="px-1"
            >
              <div className="grid gap-1 sm:grid-cols-2">
                {Object.entries(EDIT_TYPES).map(([editType, { label }]) => (
                  <button
                    key={editType}
                    type="button"
                    onClick={() => addEdit(editType)}
                    className="ls-pressable min-h-10 rounded-lg px-2.5 py-2 text-left text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Disclosure>
          )}

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
              <label htmlFor="edit-notes" className="text-xs font-semibold">
                Anything else? <span className="font-normal normal-case tracking-normal text-muted-foreground">Optional</span>
              </label>
              <Input
                id="edit-notes"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="e.g. keep the fireplace as-is and use warm neutral fabrics"
                className="mt-2 w-full"
              />
            </div>
          )}
          <div className="ls-scroll-edge -mx-4 mt-5 bg-background/88 px-4 py-4 backdrop-blur-xl sm:-mx-5 sm:px-5 md:sticky md:bottom-0 md:z-10">
            <p className="mb-2 text-[0.68rem] font-semibold text-muted-foreground">
              {photoIds.length > 1 ? `${photoIds.length} photos` : "1 photo"} · {chain.length || (ideas ? 4 : 0)} {chain.length === 1 ? "edit" : "edits"}
            </p>
            <div className="flex items-center gap-3">
              <Select
                aria-label="Output size"
                value={sizePreset}
                onChange={(e) => setSizePreset(e.target.value)}
                className="w-auto min-w-32 bg-transparent shadow-none"
              >
                {Object.entries(SIZE_PRESETS).map(([k, label]) => (
                  <option key={k} value={k} data-description={k === "original" ? "Keep maximum detail" : "Ready for common portals"}>
                    {label}
                  </option>
                ))}
              </Select>
              <Button className="ml-auto min-w-40 shadow-[0_8px_24px_color-mix(in_oklch,var(--primary)_24%,transparent)]" size="lg" onClick={run} disabled={!canRun || running}>
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
