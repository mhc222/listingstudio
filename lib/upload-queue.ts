// relative .ts import (not "@/") so plain node can load this module for
// scripts/test-background-uploads.mjs, as lib/storage.ts does since Phase 56
import { validateUploadDeclaration } from "../config/uploads.ts"

export const TUS_CHUNK_SIZE = 6 * 1024 * 1024
export const MAX_CONCURRENT_UPLOADS = 3
// Phase 55 refresh discipline. A listing refresh re-runs every listing query
// and re-downloads the full-resolution grid, so a running batch refreshes at
// most once per interval (matching the 5 s status-poll rhythm) and once more,
// almost immediately, when the batch drains.
export const UPLOAD_REFRESH_INTERVAL_MS = 5000
export const UPLOAD_REFRESH_DRAIN_MS = 350
// Whole-queue localStorage writes are synchronous; progress ticks persist on a
// trailing throttle while every status transition and pagehide flushes at once.
export const UPLOAD_PERSIST_THROTTLE_MS = 500
// Phase 57 background finalize. The server answers finalize with 202 and
// finishes after the response; while any item is finalizing the queue polls
// its rows at the existing 5 s cadence and moves them to uploaded/failed.
export const UPLOAD_FINALIZE_POLL_MS = UPLOAD_REFRESH_INTERVAL_MS
export const UPLOAD_POLL_MAX_IDS = 50
// Signed upload tokens from prepare/authorize last 7200 s; a token this close
// to expiry is renewed before the transfer starts instead of failing mid-PUT.
export const UPLOAD_TOKEN_RENEW_MARGIN_MS = 60_000
export const BACKGROUND_UPLOAD_NOTICE =
  "Uploads continue in the background. Once a file finishes transferring you can keep working or close this tab; the photo appears in the grid when it is ready."

export type UploadKind = "photo" | "floor-plan"
export type UploadServerStatus =
  | "reserved"
  | "finalizing"
  | "complete"
  | "failed"
  | "canceled"
export type UploadQueueStatus =
  | "waiting"
  | "uploading"
  | "finalizing"
  | "uploaded"
  | "needs-attention"
  | "canceled"

export type PreparedUploadItem = {
  id: string
  batchId: string
  photoId: string
  name: string
  size: number
  contentType: string
  intakePath: string
  token: string
  isFloorPlan: boolean
}

export type PersistedUploadItem = PreparedUploadItem & {
  status: UploadQueueStatus
  serverStatus: UploadServerStatus
  progress: number
  error: string | null
  uploadUrl: string | null
  transferComplete: boolean
  paused: boolean
  createdAt: string
  // ISO time the signed upload token stops working (prepare/authorize
  // expiresInSeconds); absent on rows persisted before Phase 57.
  tokenExpiresAt?: string | null
}

export function uploadTokenExpired(
  item: Pick<PersistedUploadItem, "token" | "tokenExpiresAt">,
  now: number,
  marginMs = UPLOAD_TOKEN_RENEW_MARGIN_MS
) {
  if (!item.token) return true
  if (!item.tokenExpiresAt) return false
  return Date.parse(item.tokenExpiresAt) - marginMs <= now
}

export function validateBrowserUpload(file: File, kind: UploadKind) {
  return validateUploadDeclaration({
    name: file.name,
    size: file.size,
    type: file.type,
    isFloorPlan: kind === "floor-plan",
  })
}

export function getTusEndpoint(projectUrl: string) {
  const url = new URL(projectUrl)
  const origin = url.hostname.endsWith(".supabase.co")
    ? `${url.protocol}//${url.hostname.replace(".supabase.co", ".storage.supabase.co")}`
    : url.origin
  return `${origin}/storage/v1/upload/resumable`
}

export function queueFingerprint(itemId: string, file: File) {
  return Promise.resolve(
    ["listing-studio", itemId, file.name, file.type || "unknown", file.size, file.lastModified].join(
      "-"
    )
  )
}

export function formatUploadBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`
}

export const QUEUE_STATUS_LABEL: Record<UploadQueueStatus, string> = {
  waiting: "Waiting",
  uploading: "Uploading",
  finalizing: "Finalizing",
  uploaded: "Uploaded",
  "needs-attention": "Needs attention",
  canceled: "Canceled",
}
