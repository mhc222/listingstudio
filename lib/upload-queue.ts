import { validateUploadDeclaration } from "@/config/uploads"

export const TUS_CHUNK_SIZE = 6 * 1024 * 1024
export const MAX_CONCURRENT_UPLOADS = 3

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
