"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import * as tus from "tus-js-client"
import { WorkflowConnectivity, useOnlineState } from "@/components/workflow-connectivity"
import { Button } from "@/components/ui/button"
import { MAX_UPLOAD_FILES, UPLOAD_FILE_LIMIT_LABEL } from "@/config/uploads"
import {
  BACKGROUND_UPLOAD_NOTICE,
  formatUploadBytes,
  getTusEndpoint,
  MAX_CONCURRENT_UPLOADS,
  type PersistedUploadItem,
  QUEUE_STATUS_LABEL,
  queueFingerprint,
  TUS_CHUNK_SIZE,
  UPLOAD_FINALIZE_POLL_MS,
  UPLOAD_PERSIST_THROTTLE_MS,
  UPLOAD_POLL_MAX_IDS,
  UPLOAD_REFRESH_DRAIN_MS,
  UPLOAD_REFRESH_INTERVAL_MS,
  type UploadKind,
  type UploadQueueStatus,
  type UploadServerStatus,
  uploadTokenExpired,
  validateBrowserUpload,
} from "@/lib/upload-queue"
import {
  clearUploadPlaceholders,
  type PlaceholderStage,
  syncUploadPlaceholders,
} from "@/lib/upload-placeholders"
import { coalesce } from "@/lib/refresh-discipline"
import { createClient } from "@/lib/supabase/client"
import { workflowFailureMessage } from "@/lib/workflow-recovery"

type QueueItem = PersistedUploadItem & {
  file: File | null
  localOnly?: boolean
}

type RecoveryItem = {
  id: string
  batch_id: string
  photo_id: string
  original_filename: string
  declared_byte_size: number
  declared_content_type: string
  is_floor_plan: boolean
  intake_path: string
  status: UploadServerStatus
  error: string | null
  finalized_at: string | null
  created_at: string
}

type PrepareResponse = {
  batchId: string
  expiresInSeconds: number
  items: Array<{
    id: string
    photoId: string
    name: string
    size: number
    contentType: string
    intakePath: string
    signedUrl: string
    token: string
  }>
  error?: string
}

// Which grid placeholder (if any) a queue item earns. Floor plans are not in
// the photo grid; local-only rows never reached the server.
function placeholderStage(item: QueueItem): PlaceholderStage | null {
  if (item.localOnly || item.isFloorPlan) return null
  if (item.status === "finalizing") return "processing"
  if (item.status === "uploading" || (item.status === "waiting" && item.file)) return "uploading"
  // keep the local preview in place until the real photo row replaces it
  if (item.status === "uploaded" && item.file) return "saved"
  return null
}

const STATUS_TONE: Record<UploadQueueStatus, string> = {
  waiting: "text-muted-foreground",
  uploading: "text-foreground",
  finalizing: "text-foreground",
  uploaded: "text-emerald-700 dark:text-emerald-300",
  "needs-attention": "text-destructive",
  canceled: "text-muted-foreground",
}

function storageKey(listingId: string) {
  return `listing-studio:upload-queue:v1:${listingId}`
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function isInFlight(item: QueueItem) {
  return (
    item.status === "uploading" ||
    item.status === "finalizing" ||
    (item.status === "waiting" && !item.paused && Boolean(item.file))
  )
}

// Everything except the per-tick progress number: a change here is a status
// transition worth persisting immediately, anything else is throttled.
function persistSignature(items: QueueItem[]) {
  return items
    .map(
      (item) =>
        `${item.id}:${item.status}:${item.serverStatus}:${item.paused ? 1 : 0}:${item.transferComplete ? 1 : 0}:${item.uploadUrl ?? ""}:${item.error ?? ""}`
    )
    .join("|")
}

function transferErrorMessage(error: unknown) {
  const message = errorMessage(error, "upload interrupted")
  if (/Invalid Compact JWS|AccessDenied|Unauthorized/i.test(message)) {
    return "Upload access could not be verified"
  }
  if (/network|fetch|offline|connection/i.test(message)) {
    return "The connection was interrupted"
  }
  return "The direct upload could not continue"
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    throw new Error(workflowFailureMessage({
      status: response.status,
      serverMessage: body.error,
      fallback: `The upload request failed (${response.status}).`,
      preserved: "Uploaded chunks, completed files, and the rest of the queue are preserved.",
    }))
  }
  return body
}

function localErrorItem(file: File, kind: UploadKind, message: string): QueueItem {
  return {
    id: `local-${crypto.randomUUID()}`,
    batchId: "local",
    photoId: "",
    name: file.name,
    size: file.size,
    contentType: file.type || "unknown",
    intakePath: "",
    token: "",
    isFloorPlan: kind === "floor-plan",
    status: "needs-attention",
    serverStatus: "failed",
    progress: 0,
    error: message,
    uploadUrl: null,
    transferComplete: false,
    paused: false,
    createdAt: new Date().toISOString(),
    file,
    localOnly: true,
  }
}

function restoredStatus(item: PersistedUploadItem): Pick<QueueItem, "status" | "paused" | "error"> {
  if (item.status === "uploading" || item.status === "waiting") {
    return {
      status: "needs-attention",
      paused: true,
      error:
        "This upload paused when the page reloaded. Uploaded chunks are preserved. Choose the same file to continue.",
    }
  }
  return { status: item.status, paused: item.paused, error: item.error }
}

export function UploadQueue({ listingId }: { listingId: string }) {
  const router = useRouter()
  const { online } = useOnlineState()
  const photoInput = useRef<HTMLInputElement>(null)
  const planInput = useRef<HTMLInputElement>(null)
  const recoveryInput = useRef<HTMLInputElement>(null)
  const recoveryTargetRef = useRef<string | "all" | null>(null)
  const activeUploads = useRef(new Map<string, tus.Upload>())
  const activeIds = useRef(new Set<string>())
  // finalize is fire-and-forget (Phase 57): remember which items already had
  // their POST so the scheduler sends exactly one per transfer (Retry clears it)
  const finalizeRequested = useRef(new Set<string>())
  const itemsRef = useRef<QueueItem[]>([])
  const hydratedRef = useRef(false)
  const persistedSignature = useRef<string | null>(null)
  const [items, setItems] = useState<QueueItem[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [recoveryTarget, setRecoveryTarget] = useState<string | "all" | null>(null)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)

  function openRecoveryPicker(target: string | "all") {
    recoveryTargetRef.current = target
    setRecoveryTarget(target)
    if (recoveryInput.current) {
      recoveryInput.current.multiple = target === "all"
      recoveryInput.current.click()
    }
  }

  const replaceItems = useCallback((next: QueueItem[]) => {
    itemsRef.current = next
    setItems(next)
  }, [])

  const updateItem = useCallback((itemId: string, patch: Partial<QueueItem>) => {
    const next = itemsRef.current.map((item) =>
      item.id === itemId ? { ...item, ...patch } : item
    )
    itemsRef.current = next
    setItems(next)
  }, [])

  const removeItem = useCallback((itemId: string) => {
    const next = itemsRef.current.filter((item) => item.id !== itemId)
    itemsRef.current = next
    setItems(next)
  }, [])

  // One listing refresh per batch, not per photo: while other items are still
  // in flight the refresh is throttled to the interval; the item that drains
  // the batch refreshes almost immediately.
  const refreshRunner = useMemo(
    () => coalesce(() => router.refresh(), { minIntervalMs: UPLOAD_REFRESH_INTERVAL_MS }),
    [router]
  )
  const refreshPhotos = useCallback(() => {
    const busy = itemsRef.current.some(isInFlight)
    refreshRunner.request(busy ? undefined : { minIntervalMs: UPLOAD_REFRESH_DRAIN_MS })
  }, [refreshRunner])

  const persistQueue = useCallback(() => {
    if (!hydratedRef.current) return
    const persistent = itemsRef.current
      .filter((item) => !item.localOnly)
      .map((item) => {
        const { file, localOnly, ...persisted } = item
        void file
        void localOnly
        return persisted
      })
    localStorage.setItem(storageKey(listingId), JSON.stringify(persistent))
  }, [listingId])
  const persistRunner = useMemo(
    () => coalesce(persistQueue, { minIntervalMs: UPLOAD_PERSIST_THROTTLE_MS }),
    [persistQueue]
  )

  const finalizeItem = useCallback(
    async (itemId: string) => {
      updateItem(itemId, {
        status: "finalizing",
        serverStatus: "finalizing",
        progress: 100,
        transferComplete: true,
        paused: false,
        error: null,
      })
      try {
        const response = await fetch(`/api/uploads/${itemId}/finalize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
        const body = await jsonResponse<{ status: "finalizing" | "complete"; photoId: string }>(response)
        if (body.status === "complete") {
          updateItem(itemId, {
            status: "uploaded",
            serverStatus: "complete",
            progress: 100,
            error: null,
          })
          refreshPhotos()
        }
        // 202 "finalizing": the server finishes after its response; the status
        // poll below moves the item to uploaded (or needs-attention) when it lands.
      } catch (error) {
        finalizeRequested.current.delete(itemId)
        updateItem(itemId, {
          status: "needs-attention",
          serverStatus: "failed",
          error: `${errorMessage(error, "Finalization failed")}. The uploaded file and every successful item are preserved. Choose Retry, or cancel this item and add a corrected file.`,
        })
      }
    },
    [refreshPhotos, updateItem]
  )

  const reauthorize = useCallback(
    async (item: Pick<QueueItem, "id">) => {
      const response = await fetch(`/api/uploads/${item.id}/authorize`, { method: "POST" })
      const body = await jsonResponse<{ token: string; intakePath: string; expiresInSeconds: number }>(response)
      const tokenExpiresAt = new Date(Date.now() + (body.expiresInSeconds || 7200) * 1000).toISOString()
      updateItem(item.id, { token: body.token, intakePath: body.intakePath, tokenExpiresAt })
      return { ...body, tokenExpiresAt }
    },
    [updateItem]
  )

  const startTransfer = useCallback(
    async (itemId: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === itemId)
      if (!item?.file) {
        activeIds.current.delete(itemId)
        updateItem(itemId, {
          status: "needs-attention",
          paused: true,
          error: "Choose the same file to continue this upload. Uploaded chunks are preserved.",
        })
        return
      }

      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        activeIds.current.delete(itemId)
        updateItem(itemId, {
          status: "needs-attention",
          serverStatus: "reserved",
          error: `${item.name}: your sign-in expired. Uploaded chunks and completed files are preserved. Sign in again, then choose Retry.`,
        })
        return
      }

      // prepare already signed this object; /authorize is only for a missing or
      // expiring token (retry, resume after reload, long-paused queue)
      let token = item.token
      if (uploadTokenExpired(item, Date.now())) {
        try {
          token = (await reauthorize(item)).token
        } catch (error) {
          activeIds.current.delete(itemId)
          updateItem(itemId, {
            status: "needs-attention",
            serverStatus: "reserved",
            error: `${item.name}: ${errorMessage(error, "could not renew upload access")}. Uploaded chunks and completed files are preserved. Choose Retry.`,
          })
          return
        }
      }

      const upload = new tus.Upload(item.file, {
        endpoint: getTusEndpoint(process.env.NEXT_PUBLIC_SUPABASE_URL!),
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "x-signature": token,
          "x-upsert": "false",
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: TUS_CHUNK_SIZE,
        metadata: {
          bucketName: "intake",
          objectName: item.intakePath,
          contentType: item.contentType,
          cacheControl: "3600",
        },
        fingerprint: (file) => queueFingerprint(item.id, file),
        onUploadUrlAvailable: () => {
          updateItem(item.id, { uploadUrl: upload.url })
        },
        onProgress: (bytesSent, bytesTotal) => {
          const progress = bytesTotal ? Math.min(100, Math.round((bytesSent / bytesTotal) * 100)) : 0
          const current = itemsRef.current.find((candidate) => candidate.id === item.id)
          if (
            current &&
            current.status === "uploading" &&
            current.progress === progress &&
            current.uploadUrl === upload.url &&
            current.error === null
          ) {
            return
          }
          updateItem(item.id, {
            status: "uploading",
            serverStatus: "reserved",
            progress,
            uploadUrl: upload.url,
            error: null,
          })
        },
        onError: (error) => {
          activeIds.current.delete(item.id)
          activeUploads.current.delete(item.id)
          updateItem(item.id, {
            status: "needs-attention",
            serverStatus: "reserved",
            paused: false,
            uploadUrl: upload.url,
            error: `${item.name}: ${transferErrorMessage(error)}. Uploaded chunks and completed files are preserved. Choose Retry to continue this file.`,
          })
        },
        onSuccess: () => {
          // the transfer slot is released here, not after finalize: the
          // scheduler fires the finalize POST and starts the next transfer
          activeIds.current.delete(item.id)
          activeUploads.current.delete(item.id)
          updateItem(item.id, {
            status: "finalizing",
            serverStatus: "finalizing",
            progress: 100,
            transferComplete: true,
            uploadUrl: upload.url,
            error: null,
          })
        },
      })

      activeUploads.current.set(item.id, upload)
      updateItem(item.id, { status: "uploading", paused: false, error: null })
      try {
        const previous = await upload.findPreviousUploads()
        const matching = previous.find(
          (candidate) =>
            candidate.uploadUrl &&
            candidate.size === item.size &&
            candidate.metadata?.objectName === item.intakePath
        )
        if (matching) upload.resumeFromPreviousUpload(matching)
        upload.start()
      } catch (error) {
        activeIds.current.delete(item.id)
        activeUploads.current.delete(item.id)
        updateItem(item.id, {
          status: "needs-attention",
          serverStatus: "reserved",
          error: `${item.name}: ${transferErrorMessage(error)}. Uploaded chunks and completed files are preserved. Choose Retry.`,
        })
      }
    },
    [reauthorize, updateItem]
  )

  useEffect(() => {
    if (!hydrated) return
    // finalize holds no transfer slot: one fire-and-forget POST per transfer
    for (const item of items) {
      if (
        item.status === "finalizing" &&
        item.transferComplete &&
        !item.localOnly &&
        !finalizeRequested.current.has(item.id)
      ) {
        finalizeRequested.current.add(item.id)
        void finalizeItem(item.id)
      }
    }
    const capacity = MAX_CONCURRENT_UPLOADS - activeIds.current.size
    if (capacity <= 0) return
    const startable = items.filter(
      (item) =>
        !activeIds.current.has(item.id) && item.status === "waiting" && !item.paused && item.file
    )
    for (const item of startable.slice(0, capacity)) {
      activeIds.current.add(item.id)
      void startTransfer(item.id)
    }
  }, [finalizeItem, hydrated, items, startTransfer])

  // Background finalize lands out of band; poll the finalizing rows at the
  // refresh cadence until each is complete or failed, then refresh the grid.
  const finalizingKey = useMemo(
    () =>
      items
        .filter((item) => item.status === "finalizing" && !item.localOnly)
        .map((item) => item.id)
        .sort()
        .join(","),
    [items]
  )
  useEffect(() => {
    if (!hydrated || !finalizingKey) return
    const ids = finalizingKey.split(",").slice(0, UPLOAD_POLL_MAX_IDS)
    let disposed = false
    async function poll() {
      try {
        const response = await fetch(
          `/api/uploads?listingId=${encodeURIComponent(listingId)}&ids=${ids.join(",")}`,
          { cache: "no-store" }
        )
        const body = await jsonResponse<{ items: RecoveryItem[] }>(response)
        if (disposed) return
        let landed = false
        for (const server of body.items) {
          const current = itemsRef.current.find((item) => item.id === server.id)
          if (!current || current.status !== "finalizing") continue
          if (server.status === "complete") {
            landed = true
            updateItem(server.id, { status: "uploaded", serverStatus: "complete", progress: 100, error: null })
          } else if (server.status === "failed") {
            updateItem(server.id, {
              status: "needs-attention",
              serverStatus: "failed",
              error: `${server.original_filename}: ${server.error || "finalization failed"}. The uploaded file and every successful item are preserved. Choose Retry, or cancel this item and add a corrected file.`,
            })
          } else if (server.status === "canceled") {
            updateItem(server.id, { status: "canceled", serverStatus: "canceled", paused: false, error: null })
          }
        }
        if (landed) refreshPhotos()
      } catch {
        // transient; the next tick retries
      }
    }
    const timer = setInterval(() => void poll(), UPLOAD_FINALIZE_POLL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [finalizingKey, hydrated, listingId, refreshPhotos, updateItem])

  // Publish placeholder tiles for the grid; object URLs are created once per
  // item and revoked when it leaves the pending set or the queue unmounts.
  useEffect(() => {
    if (!hydrated) return
    syncUploadPlaceholders(
      listingId,
      items.flatMap((item) => {
        const stage = placeholderStage(item)
        return stage
          ? [{ id: item.id, photoId: item.photoId, name: item.name, isFloorPlan: item.isFloorPlan, stage, file: item.file }]
          : []
      })
    )
  }, [hydrated, items, listingId])
  useEffect(() => () => clearUploadPlaceholders(listingId), [listingId])

  useEffect(() => {
    if (!hydrated) return
    hydratedRef.current = true
    const signature = persistSignature(items)
    if (signature !== persistedSignature.current) {
      persistedSignature.current = signature
      persistRunner.flush()
    } else {
      persistRunner.request()
    }
  }, [hydrated, items, persistRunner])

  useEffect(() => {
    if (!hydrated) return
    const flush = () => persistRunner.flush()
    window.addEventListener("pagehide", flush)
    window.addEventListener("beforeunload", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      window.removeEventListener("beforeunload", flush)
      flush()
    }
  }, [hydrated, persistRunner])

  useEffect(() => {
    let disposed = false
    async function hydrateQueue() {
      let localItems: QueueItem[] = []
      try {
        const raw = localStorage.getItem(storageKey(listingId))
        const stored = raw ? (JSON.parse(raw) as PersistedUploadItem[]) : []
        localItems = stored.map((item) => ({
          ...item,
          ...restoredStatus(item),
          file: null,
        }))
      } catch {
        localStorage.removeItem(storageKey(listingId))
      }

      try {
        const response = await fetch(`/api/uploads?listingId=${encodeURIComponent(listingId)}`, {
          cache: "no-store",
        })
        const body = await jsonResponse<{ items: RecoveryItem[] }>(response)
        const merged = new Map(localItems.map((item) => [item.id, item]))
        const serverIds = new Set(body.items.map((item) => item.id))
        for (const server of body.items) {
          const local = merged.get(server.id)
          if (!local && ["complete", "canceled"].includes(server.status)) continue
          const base: QueueItem =
            local ??
            ({
              id: server.id,
              batchId: server.batch_id,
              photoId: server.photo_id,
              name: server.original_filename,
              size: Number(server.declared_byte_size),
              contentType: server.declared_content_type,
              intakePath: server.intake_path,
              token: "",
              isFloorPlan: server.is_floor_plan,
              status: "needs-attention",
              serverStatus: server.status,
              progress: 0,
              error: null,
              uploadUrl: null,
              transferComplete: false,
              paused: true,
              createdAt: server.created_at,
              file: null,
            } satisfies QueueItem)

          if (server.status === "complete") {
            merged.set(server.id, {
              ...base,
              status: "uploaded",
              serverStatus: "complete",
              progress: 100,
              transferComplete: true,
              paused: false,
              error: null,
            })
          } else if (server.status === "canceled") {
            merged.set(server.id, {
              ...base,
              status: "canceled",
              serverStatus: "canceled",
              paused: false,
              error: null,
            })
          } else if (server.status === "finalizing") {
            merged.set(server.id, {
              ...base,
              status: "finalizing",
              serverStatus: "finalizing",
              progress: 100,
              transferComplete: true,
              paused: false,
              error: null,
            })
          } else if (server.status === "failed") {
            merged.set(server.id, {
              ...base,
              status: "needs-attention",
              serverStatus: "failed",
              progress: Math.max(base.progress, 100),
              transferComplete: true,
              paused: false,
              error: `${server.original_filename}: ${server.error || "finalization failed"}. The uploaded file and every successful item are preserved. Choose Retry, or cancel this item and add a corrected file.`,
            })
          } else {
            merged.set(server.id, {
              ...base,
              status: base.file ? base.status : "needs-attention",
              serverStatus: "reserved",
              paused: !base.file,
              error: base.file
                ? base.error
                : `${server.original_filename}: upload interrupted. Uploaded chunks and completed files are preserved. Choose the same file to continue.`,
            })
          }
        }
        localItems = [...merged.values()]
          .filter(
            (item) =>
              serverIds.has(item.id) || ["uploaded", "canceled"].includes(item.status)
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      } catch (error) {
        setRecoveryError(
          `Upload recovery is temporarily unavailable: ${errorMessage(error, "try reloading")}. Your server-side upload records are preserved.`
        )
      }

      if (!disposed) {
        replaceItems(localItems)
        setHydrated(true)
      }
    }
    void hydrateQueue()
    return () => {
      disposed = true
    }
  }, [listingId, replaceItems])

  useEffect(
    () => () => {
      refreshRunner.cancel()
      for (const upload of activeUploads.current.values()) void upload.abort(false)
    },
    [refreshRunner]
  )

  useEffect(() => {
    if (online) return
    let changed = false
    for (const [itemId, upload] of activeUploads.current.entries()) {
      void upload.abort(false)
      activeUploads.current.delete(itemId)
      activeIds.current.delete(itemId)
      changed = true
    }
    if (!changed) return
    const next = itemsRef.current.map((item) =>
      item.status === "uploading"
        ? {
            ...item,
            status: "waiting" as const,
            paused: true,
            error: `${item.name}: the device went offline. Uploaded chunks and completed files are preserved. Reconnect, then choose Resume.`,
          }
        : item
    )
    replaceItems(next)
  }, [online, replaceItems])

  const reserveFiles = useCallback(
    async (selectedFiles: File[], kind: UploadKind) => {
      if (selectedFiles.length === 0) return
      if (selectedFiles.length > MAX_UPLOAD_FILES) {
        replaceItems([
          ...itemsRef.current,
          localErrorItem(
            selectedFiles[0],
            kind,
            `Choose no more than ${MAX_UPLOAD_FILES} files at once. Nothing from this selection was reserved.`
          ),
        ])
        return
      }

      const valid: Array<{ file: File; declaration: ReturnType<typeof validateBrowserUpload> }> = []
      const invalid: QueueItem[] = []
      for (const file of selectedFiles) {
        try {
          valid.push({ file, declaration: validateBrowserUpload(file, kind) })
        } catch (error) {
          invalid.push(
            localErrorItem(
              file,
              kind,
              `${errorMessage(error, "This file is not accepted")}. No upload started for this file; the rest of the selection is unchanged.`
            )
          )
        }
      }
      if (invalid.length) replaceItems([...itemsRef.current, ...invalid])
      if (!valid.length) return

      try {
        const response = await fetch("/api/uploads/prepare", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listingId,
            files: valid.map(({ declaration }) => ({
              name: declaration.originalFilename,
              size: declaration.byteSize,
              type: declaration.contentType,
              isFloorPlan: declaration.isFloorPlan,
              roomId: declaration.roomId,
            })),
          }),
        })
        const prepared = await jsonResponse<PrepareResponse>(response)
        const createdAt = new Date().toISOString()
        const tokenExpiresAt = new Date(Date.now() + (prepared.expiresInSeconds || 7200) * 1000).toISOString()
        const nextItems: QueueItem[] = prepared.items.map(({ signedUrl, ...item }, index) => ({
          ...item,
          batchId: prepared.batchId,
          tokenExpiresAt: signedUrl ? tokenExpiresAt : null,
          isFloorPlan: kind === "floor-plan",
          status: "waiting",
          serverStatus: "reserved",
          progress: 0,
          error: null,
          uploadUrl: null,
          transferComplete: false,
          paused: false,
          createdAt,
          file: valid[index].file,
        }))
        replaceItems([...itemsRef.current, ...nextItems])
      } catch (error) {
        const message = errorMessage(error, "could not reserve upload")
        replaceItems([
          ...itemsRef.current,
          ...valid.map(({ file }) =>
            localErrorItem(
              file,
              kind,
              `${file.name}: ${message}. Nothing was uploaded; choose Retry for this file.`
            )
          ),
        ])
      }
    },
    [listingId, replaceItems]
  )

  async function pauseItem(item: QueueItem) {
    const upload = activeUploads.current.get(item.id)
    if (!upload) return
    await upload.abort(false)
    activeUploads.current.delete(item.id)
    activeIds.current.delete(item.id)
    updateItem(item.id, { status: "waiting", paused: true, error: null, uploadUrl: upload.url })
  }

  async function cancelItem(item: QueueItem) {
    if (item.localOnly) {
      removeItem(item.id)
      return
    }
    const upload = activeUploads.current.get(item.id)
    if (upload) await upload.abort(true).catch(() => undefined)
    activeUploads.current.delete(item.id)
    activeIds.current.delete(item.id)
    try {
      const response = await fetch(`/api/uploads/${item.id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      await jsonResponse<{ status: "canceled" }>(response)
      updateItem(item.id, {
        status: "canceled",
        serverStatus: "canceled",
        paused: false,
        error: null,
      })
    } catch (error) {
      updateItem(item.id, {
        status: "needs-attention",
        error: `${item.name}: ${errorMessage(error, "could not cancel")}. Your uploaded work is preserved; retry cancel or continue the upload.`,
      })
    }
  }

  async function retryItem(item: QueueItem) {
    if (item.localOnly) {
      removeItem(item.id)
      if (item.file) await reserveFiles([item.file], item.isFloorPlan ? "floor-plan" : "photo")
      return
    }
    if (item.transferComplete || ["failed", "finalizing"].includes(item.serverStatus)) {
      finalizeRequested.current.delete(item.id)
      updateItem(item.id, { status: "finalizing", paused: false, error: null })
      return
    }
    if (!item.file) {
      openRecoveryPicker(item.id)
      return
    }
    try {
      const authorization = await reauthorize(item)
      updateItem(item.id, {
        token: authorization.token,
        intakePath: authorization.intakePath,
        status: "waiting",
        paused: false,
        error: null,
      })
    } catch (error) {
      updateItem(item.id, {
        status: "needs-attention",
        error: `${item.name}: ${errorMessage(error, "could not renew upload access")}. Uploaded chunks and completed files are preserved. Choose Retry.`,
      })
    }
  }

  async function attachRecoveryFiles(selected: File[]) {
    const candidates = itemsRef.current.filter(
      (item) =>
        !item.localOnly &&
        item.serverStatus === "reserved" &&
        item.status === "needs-attention" &&
        !item.file
    )
    const target = recoveryTargetRef.current
    const targetIds = target === "all" ? null : new Set([target])
    const matchedIds = new Set<string>()
    let matched = 0
    for (const file of selected) {
      const item = candidates.find(
        (candidate) =>
          !matchedIds.has(candidate.id) &&
          (!targetIds || targetIds.has(candidate.id)) &&
          candidate.name === file.name &&
          candidate.size === file.size
      )
      if (!item) continue
      try {
        validateBrowserUpload(file, item.isFloorPlan ? "floor-plan" : "photo")
        const authorization = await reauthorize(item)
        updateItem(item.id, {
          file,
          token: authorization.token,
          intakePath: authorization.intakePath,
          status: "waiting",
          paused: false,
          error: null,
        })
        matchedIds.add(item.id)
        matched += 1
      } catch (error) {
        updateItem(item.id, {
          status: "needs-attention",
          error: `${item.name}: ${errorMessage(error, "could not resume")}. Uploaded chunks and completed files are preserved.`,
        })
      }
    }
    if (matched === 0 && selected.length) {
      setRecoveryError("No selected file matched the interrupted upload’s exact filename and byte size.")
    } else {
      setRecoveryError(null)
    }
    recoveryTargetRef.current = null
    setRecoveryTarget(null)
  }

  const counts = useMemo(
    () => ({
      uploaded: items.filter((item) => item.status === "uploaded").length,
      active: items.filter((item) => ["waiting", "uploading", "finalizing"].includes(item.status))
        .length,
      attention: items.filter((item) => item.status === "needs-attention").length,
      canceled: items.filter((item) => item.status === "canceled").length,
    }),
    [items]
  )

  const retryable = items.filter((item) => item.status === "needs-attention")
  const interrupted = retryable.filter(
    (item) => !item.localOnly && item.serverStatus === "reserved" && !item.file
  )

  return (
    <section id="upload-queue" aria-labelledby="upload-heading" className="scroll-mt-24 space-y-3">
      <WorkflowConnectivity preserved="The queue, uploaded chunks, and completed files are preserved. Active browser uploads pause until you reconnect." />
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={photoInput}
          id={`listing-photo-upload-${listingId}`}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          className="hidden"
          onChange={(event) => {
            void reserveFiles(Array.from(event.target.files ?? []), "photo")
            event.target.value = ""
          }}
        />
        <input
          ref={planInput}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            void reserveFiles(Array.from(event.target.files ?? []), "floor-plan")
            event.target.value = ""
          }}
        />
        <input
          ref={recoveryInput}
          type="file"
          multiple={recoveryTarget === "all"}
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            void attachRecoveryFiles(Array.from(event.target.files ?? []))
            event.target.value = ""
          }}
        />
        <Button type="button" onClick={() => photoInput.current?.click()} disabled={!online}>Upload photos</Button>
        <Button type="button" variant="outline" onClick={() => planInput.current?.click()} disabled={!online}>
          Attach floor plan
        </Button>
        {interrupted.length > 1 && (
          <Button
            variant="ghost"
            disabled={!online}
            onClick={() => {
              openRecoveryPicker("all")
            }}
          >
            Resume files
          </Button>
        )}
      </div>
      <p id="upload-heading" className="text-xs leading-relaxed text-muted-foreground">
        JPG, PNG, WebP, HEIC, or HEIF · up to {UPLOAD_FILE_LIMIT_LABEL} each · up to{" "}
        {MAX_UPLOAD_FILES} files per selection. PDFs are accepted only as floor plans. On a phone,
        choose Camera Roll or Files. Keep this tab open while a file is transferring; once it reaches
        Finalizing the server finishes it on its own. If the browser or phone closes a transfer,
        return and reselect the exact files to reconnect saved chunks.
      </p>

      {recoveryError && (
        <p role="alert" className="text-sm text-destructive">
          {recoveryError}
        </p>
      )}

      {items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/70">
          <div className="flex flex-col gap-2 border-b border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Uploads</h2>
              <p aria-live="polite" className="mt-0.5 text-xs text-muted-foreground">
                {counts.uploaded} uploaded · {counts.active} in progress
                {counts.attention ? ` · ${counts.attention} need attention` : ""}
                {counts.canceled ? ` · ${counts.canceled} canceled` : ""}
              </p>
              {counts.active > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">{BACKGROUND_UPLOAD_NOTICE}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {retryable.some((item) => item.file || item.transferComplete) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    for (const item of retryable) {
                      if (item.file || item.transferComplete) void retryItem(item)
                    }
                  }}
                >
                  Retry failed
                </Button>
              )}
              {items.some((item) => ["uploaded", "canceled"].includes(item.status)) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    replaceItems(
                      itemsRef.current.filter(
                        (item) => !["uploaded", "canceled"].includes(item.status)
                      )
                    )
                  }
                >
                  Clear finished
                </Button>
              )}
            </div>
          </div>

          <ul className="divide-y divide-border/55">
            {items.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <p className="truncate text-sm font-medium" title={item.name}>
                        {item.name}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.isFloorPlan ? "Floor plan" : "Photo"} · {formatUploadBytes(item.size)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div
                        role="progressbar"
                        aria-label={`${item.name} upload progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(item.progress)}
                        className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted"
                      >
                        <div
                          className={`h-full rounded-full transition-[width] ${
                            item.status === "needs-attention"
                              ? "bg-destructive"
                              : item.status === "uploaded"
                                ? "bg-emerald-600"
                                : "bg-primary"
                          }`}
                          style={{
                            width: `${Math.max(item.status === "waiting" ? 2 : 0, item.progress)}%`,
                          }}
                        />
                      </div>
                      <span
                        className={`w-24 shrink-0 text-right text-xs font-medium ${STATUS_TONE[item.status]}`}
                      >
                        {QUEUE_STATUS_LABEL[item.status]}
                        {item.status === "uploading" ? ` ${Math.round(item.progress)}%` : ""}
                      </span>
                    </div>
                    {item.paused && item.status === "waiting" && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Paused at {Math.round(item.progress)}%. Uploaded chunks are preserved.
                      </p>
                    )}
                    {item.error && (
                      <p role="alert" className="mt-1.5 text-xs leading-relaxed text-destructive">
                        {item.error}
                      </p>
                    )}
                  </div>

                  <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                    {item.status === "uploading" && (
                      <Button size="sm" variant="outline" onClick={() => void pauseItem(item)}>
                        Pause
                      </Button>
                    )}
                    {item.status === "waiting" && item.paused && item.file && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateItem(item.id, { paused: false })}
                      >
                        Resume
                      </Button>
                    )}
                    {item.status === "needs-attention" && (
                      <Button size="sm" variant="outline" onClick={() => void retryItem(item)}>
                        {item.file || item.transferComplete ? "Retry" : "Choose file"}
                      </Button>
                    )}
                    {["waiting", "uploading", "needs-attention"].includes(item.status) && (
                      <Button size="sm" variant="ghost" onClick={() => void cancelItem(item)}>
                        {item.localOnly ? "Dismiss" : "Cancel"}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
