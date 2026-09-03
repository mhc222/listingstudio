// Phase 57: the upload queue publishes the photos it is still transferring or
// finalizing so the listing grid can draw a placeholder tile in the position
// the photo will take (photos are ordered by created_at, so new ones append).
// Local previews are object URLs, created once per item and revoked as soon
// as the item leaves the pending set or the queue unmounts.
import { useSyncExternalStore } from "react"

export type PlaceholderStage = "uploading" | "processing" | "saved"

export type UploadPlaceholder = {
  id: string
  photoId: string
  name: string
  isFloorPlan: boolean
  stage: PlaceholderStage
  previewUrl: string | null
}

export type PlaceholderSource = {
  id: string
  photoId: string
  name: string
  isFloorPlan: boolean
  stage: PlaceholderStage
  file: Blob | null
}

// Browsers decode these inline; HEIC/HEIF and PDF get a neutral tile instead
// of a broken image.
const PREVIEWABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

type ObjectUrlApi = Pick<typeof URL, "createObjectURL" | "revokeObjectURL">

const placeholders = new Map<string, UploadPlaceholder[]>()
const previewUrls = new Map<string, Map<string, string>>()
const listeners = new Set<() => void>()
const EMPTY: UploadPlaceholder[] = []

function notify() {
  for (const listener of listeners) listener()
}

function signature(items: UploadPlaceholder[]) {
  return items.map((item) => `${item.id}:${item.stage}:${item.previewUrl ?? ""}`).join("|")
}

export function canPreview(file: Blob | null): file is Blob {
  return Boolean(file && PREVIEWABLE_TYPES.has(file.type))
}

// Reconciles the published placeholders for a listing with the queue's
// current pending items. Returns the published list. Object URLs are created
// for newly pending previewable files and revoked for items that dropped out.
export function syncUploadPlaceholders(
  listingId: string,
  sources: PlaceholderSource[],
  urlApi: ObjectUrlApi = URL
): UploadPlaceholder[] {
  const urls = previewUrls.get(listingId) ?? new Map<string, string>()
  const keep = new Set(sources.map((source) => source.id))
  for (const [id, url] of urls) {
    if (keep.has(id)) continue
    urlApi.revokeObjectURL(url)
    urls.delete(id)
  }
  const next = sources.map((source) => {
    let previewUrl = urls.get(source.id) ?? null
    if (!previewUrl && canPreview(source.file)) {
      previewUrl = urlApi.createObjectURL(source.file)
      urls.set(source.id, previewUrl)
    }
    return {
      id: source.id,
      photoId: source.photoId,
      name: source.name,
      isFloorPlan: source.isFloorPlan,
      stage: source.stage,
      previewUrl,
    }
  })
  if (urls.size) previewUrls.set(listingId, urls)
  else previewUrls.delete(listingId)

  const previous = placeholders.get(listingId) ?? EMPTY
  if (signature(previous) === signature(next)) return previous
  if (next.length) placeholders.set(listingId, next)
  else placeholders.delete(listingId)
  notify()
  return next
}

// Unmount path: revoke every preview for the listing and clear the tiles.
export function clearUploadPlaceholders(listingId: string, urlApi: ObjectUrlApi = URL) {
  for (const url of previewUrls.get(listingId)?.values() ?? []) urlApi.revokeObjectURL(url)
  previewUrls.delete(listingId)
  if (!placeholders.has(listingId)) return
  placeholders.delete(listingId)
  notify()
}

export function getUploadPlaceholders(listingId: string): UploadPlaceholder[] {
  return placeholders.get(listingId) ?? EMPTY
}

export function subscribeUploadPlaceholders(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePendingUploads(listingId: string): UploadPlaceholder[] {
  return useSyncExternalStore(
    subscribeUploadPlaceholders,
    () => getUploadPlaceholders(listingId),
    () => EMPTY
  )
}
