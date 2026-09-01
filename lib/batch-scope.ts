import type { EditStep } from "./prompts"

export const BATCH_SCOPE_VERSION = 1 as const

export const SELECTION_METHODS = [
  "single",
  "manual",
  "range",
  "visible",
  "room",
  "same_room_group",
] as const

export type SelectionMethod = (typeof SELECTION_METHODS)[number]

export type ScopePhoto = {
  id: string
  roomId: string | null
  roomType: string | null
  roomName: string | null
  sameRoomGroupId: string | null
  photoRole: "source" | "hdr_merged"
  hdrGroupId: string | null
}

export type ExplicitScopeTarget = {
  photoId: string
  editChain: EditStep[]
}

export type BatchScopeSnapshot = {
  version: typeof BATCH_SCOPE_VERSION
  jobKind: "normal" | "ideas"
  selectionMethod: SelectionMethod
  targetCount: number
  roomIds: string[]
  sameRoomGroupIds: string[]
  outputSize: "original" | "under_10mb" | "under_5mb"
  estimatedGenerationCount: number
  usesPerTargetOverrides: boolean
  ideaVariants?: Array<{ label: string; editChain: EditStep[] }>
  targets: Array<{
    position: number
    photoId: string
    roomId: string | null
    roomType: string | null
    sameRoomGroupId: string | null
    photoRole: "source" | "hdr_merged"
    hdrGroupId: string | null
    editChain: EditStep[]
  }>
}

export type BatchScopeResult =
  | { ok: true; snapshot: BatchScopeSnapshot; targets: ExplicitScopeTarget[] }
  | { ok: false; error: string }

const OUTPUT_SIZES = ["original", "under_10mb", "under_5mb"] as const

function stagingStep(chain: EditStep[]) {
  return chain.find((step) => step.edit_type === "VIRTUAL_STAGING")
}

function roomTypeFor(chain: EditStep[]) {
  const value = stagingStep(chain)?.options?.room_type
  return typeof value === "string" ? value : null
}

function normalizedSelectionMethod(value: unknown, count: number): SelectionMethod {
  if (count === 1) return "single"
  return typeof value === "string" && SELECTION_METHODS.includes(value as SelectionMethod)
    ? (value as SelectionMethod)
    : "manual"
}

function normalizedOutputSize(value: unknown): BatchScopeSnapshot["outputSize"] {
  return typeof value === "string" && OUTPUT_SIZES.includes(value as BatchScopeSnapshot["outputSize"])
    ? (value as BatchScopeSnapshot["outputSize"])
    : "original"
}

function sameIdsInOrder(ids: string[], targets: ExplicitScopeTarget[]) {
  return ids.length === targets.length && ids.every((id, index) => targets[index]?.photoId === id)
}

export function buildBatchScope({
  requestedPhotoIds,
  photos,
  commonChain,
  explicitTargets,
  selectionMethod,
  outputSize,
  ideaVariants,
}: {
  requestedPhotoIds: string[]
  photos: ScopePhoto[]
  commonChain: EditStep[]
  explicitTargets?: ExplicitScopeTarget[]
  selectionMethod?: unknown
  outputSize?: unknown
  ideaVariants?: Array<{ label: string; editChain: EditStep[] }>
}): BatchScopeResult {
  if (requestedPhotoIds.length === 0 || requestedPhotoIds.length !== photos.length) {
    return { ok: false, error: "The selected photo scope could not be reconciled. Refresh and select the photos again." }
  }
  if (new Set(requestedPhotoIds).size !== requestedPhotoIds.length) {
    return { ok: false, error: "A photo can appear only once in a batch." }
  }
  const photoById = new Map(photos.map((photo) => [photo.id, photo]))
  if (requestedPhotoIds.some((id) => !photoById.has(id))) {
    return { ok: false, error: "The selected photo scope changed. Refresh and select the photos again." }
  }

  const usesPerTargetOverrides = explicitTargets !== undefined
  if (explicitTargets && !sameIdsInOrder(requestedPhotoIds, explicitTargets)) {
    return { ok: false, error: "Per-photo settings must match the displayed targets in the same order." }
  }
  const targets = explicitTargets ?? requestedPhotoIds.map((photoId) => ({ photoId, editChain: commonChain }))
  if (targets.some((target) => !Array.isArray(target.editChain) || target.editChain.length === 0)) {
    return { ok: false, error: "Every selected photo needs an ordered edit chain." }
  }

  if (requestedPhotoIds.length > 1) {
    const stagingTargets = targets.filter((target) => stagingStep(target.editChain))
    if (stagingTargets.length > 0) {
      if (stagingTargets.length !== targets.length) {
        return { ok: false, error: "Virtual Staging must be explicit for every photo in this batch." }
      }
      const untagged = requestedPhotoIds.filter((id) => !photoById.get(id)?.roomId)
      if (untagged.length > 0) {
        return {
          ok: false,
          error: `Virtual Staging needs a confirmed room for every batch target. Organize ${untagged.length} untagged photo${untagged.length === 1 ? "" : "s"} first.`,
        }
      }
      const roomIds = new Set(requestedPhotoIds.map((id) => photoById.get(id)!.roomId))
      if (roomIds.size > 1 && !usesPerTargetOverrides) {
        return {
          ok: false,
          error: "These photos span different confirmed rooms. Use each photo’s confirmed room settings or edit one room at a time.",
        }
      }
      for (const target of stagingTargets) {
        const photo = photoById.get(target.photoId)!
        if (!photo.roomType || roomTypeFor(target.editChain) !== photo.roomType) {
          return {
            ok: false,
            error: `${photo.roomName ?? "A selected photo"} needs Virtual Staging settings that match its confirmed room type.`,
          }
        }
      }
    }
  }

  const orderedPhotos = requestedPhotoIds.map((id) => photoById.get(id)!)
  const targetById = new Map(targets.map((target) => [target.photoId, target]))
  const roomIds = Array.from(new Set(orderedPhotos.flatMap((photo) => photo.roomId ? [photo.roomId] : [])))
  const sameRoomGroupIds = Array.from(
    new Set(orderedPhotos.flatMap((photo) => photo.sameRoomGroupId ? [photo.sameRoomGroupId] : []))
  )
  const snapshot: BatchScopeSnapshot = {
    version: BATCH_SCOPE_VERSION,
    jobKind: ideaVariants ? "ideas" : "normal",
    selectionMethod: normalizedSelectionMethod(selectionMethod, requestedPhotoIds.length),
    targetCount: requestedPhotoIds.length,
    roomIds,
    sameRoomGroupIds,
    outputSize: normalizedOutputSize(outputSize),
    estimatedGenerationCount: ideaVariants
      ? ideaVariants.reduce((sum, variant) => sum + variant.editChain.length, 0)
      : targets.reduce((sum, target) => sum + target.editChain.length, 0),
    usesPerTargetOverrides,
    ...(ideaVariants ? { ideaVariants } : {}),
    targets: orderedPhotos.map((photo, position) => ({
      position,
      photoId: photo.id,
      roomId: photo.roomId,
      roomType: photo.roomType,
      sameRoomGroupId: photo.sameRoomGroupId,
      photoRole: photo.photoRole,
      hdrGroupId: photo.hdrGroupId,
      editChain: targetById.get(photo.id)!.editChain,
    })),
  }
  return { ok: true, snapshot, targets }
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)])
    )
  }
  return value
}

export function batchScopesEqual(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right))
}

export function withConfirmedRoomStaging(
  requestedPhotoIds: string[],
  photos: ScopePhoto[],
  chain: EditStep[]
): ExplicitScopeTarget[] {
  const photoById = new Map(photos.map((photo) => [photo.id, photo]))
  return requestedPhotoIds.map((photoId) => {
    const roomType = photoById.get(photoId)?.roomType
    return {
      photoId,
      editChain: chain.map((step) =>
        step.edit_type === "VIRTUAL_STAGING"
          ? { ...step, options: { ...(step.options ?? {}), room_type: roomType } }
          : { ...step, options: { ...(step.options ?? {}) } }
      ),
    }
  })
}
