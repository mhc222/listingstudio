import type { EditStep } from "./prompts"

export const SCOPED_REWORK_VERSION = 1 as const
export const MIN_SCOPED_REWORK_TARGETS = 2
export const MAX_SCOPED_REWORK_TARGETS = 100
export const MAX_SCOPED_REWORK_INSTRUCTIONS = 1000
export const MAX_SCOPED_REWORK_EXCEPTION = 500

export const SCOPED_REWORK_METHODS = ["explicit", "room", "same_room_group"] as const
export type ScopedReworkMethod = (typeof SCOPED_REWORK_METHODS)[number]
export type ProtectedGeometry = "interior" | "exterior"

export type ScopedReworkTargetInput = {
  sourcePhotoId: string
  sourceOutputVersionId: string
  exception: string | null
}

export type ScopedReworkInput = {
  requestId: string
  selectionMethod: ScopedReworkMethod
  scopeId: string | null
  instructions: string
  targets: ScopedReworkTargetInput[]
}

export type ScopedReworkSource = {
  sourcePhotoId: string
  sourceOutputVersionId: string
  sourceFileGroupId: string
  roomId: string | null
  sameRoomGroupId: string | null
  editChain: EditStep[]
  providerCostCents: number
}

export type ScopedReworkSnapshot = {
  schemaVersion: typeof SCOPED_REWORK_VERSION
  selectionMethod: ScopedReworkMethod
  scopeId: string | null
  sharedCorrection: string
  targetCount: number
  requestedGenerationCount: number
  initialGenerationCostCents: number
  targets: Array<{
    position: number
    sourcePhotoId: string
    sourceOutputVersionId: string
    sourceFileGroupId: string
    roomId: string | null
    sameRoomGroupId: string | null
    protectedGeometry: ProtectedGeometry
    exception: string | null
  }>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EXTERIOR_EDIT_TYPES = new Set(["DAY_TO_DUSK", "VIRTUAL_LANDSCAPING", "AERIAL_EDITING"])

function normalizedText(value: unknown, max: number, label: string, allowEmpty = false) {
  if (value === null || value === undefined) {
    if (allowEmpty) return null
    throw new Error(`${label} is required.`)
  }
  if (typeof value !== "string") throw new Error(`${label} must be text.`)
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized && allowEmpty) return null
  if (normalized.length < 2) throw new Error(`${label} must be at least 2 characters.`)
  if (normalized.length > max) throw new Error(`${label} can be at most ${max} characters.`)
  return normalized
}

function requiredUuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${label} is invalid.`)
  return value
}

export function validateScopedReworkInput(value: unknown): ScopedReworkInput {
  if (!value || typeof value !== "object") throw new Error("Batch refinement details are required.")
  const input = value as Record<string, unknown>
  const requestId = requiredUuid(input.requestId, "Retry identity")
  if (typeof input.selectionMethod !== "string" || !SCOPED_REWORK_METHODS.includes(input.selectionMethod as ScopedReworkMethod)) {
    throw new Error("Choose an explicit batch scope.")
  }
  const selectionMethod = input.selectionMethod as ScopedReworkMethod
  const scopeId = input.scopeId === null || input.scopeId === undefined || input.scopeId === ""
    ? null
    : requiredUuid(input.scopeId, "Scope")
  if (selectionMethod === "explicit" && scopeId) throw new Error("An explicit selection cannot claim a room scope.")
  if (selectionMethod !== "explicit" && !scopeId) throw new Error("The selected room scope is missing.")
  const instructions = normalizedText(
    input.instructions,
    MAX_SCOPED_REWORK_INSTRUCTIONS,
    "Shared correction"
  )!
  if (!Array.isArray(input.targets)) throw new Error("Choose the exact results to refine.")
  if (input.targets.length < MIN_SCOPED_REWORK_TARGETS || input.targets.length > MAX_SCOPED_REWORK_TARGETS) {
    throw new Error(`Choose ${MIN_SCOPED_REWORK_TARGETS}–${MAX_SCOPED_REWORK_TARGETS} results.`)
  }
  const targets = input.targets.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new Error("Every target needs an exact source result.")
    const target = candidate as Record<string, unknown>
    return {
      sourcePhotoId: requiredUuid(target.sourcePhotoId, "Source photo"),
      sourceOutputVersionId: requiredUuid(target.sourceOutputVersionId, "Source version"),
      exception: normalizedText(
        target.exception,
        MAX_SCOPED_REWORK_EXCEPTION,
        "Target exception",
        true
      ),
    }
  })
  if (new Set(targets.map((target) => target.sourcePhotoId)).size !== targets.length) {
    throw new Error("Choose only one exact result per photo.")
  }
  if (new Set(targets.map((target) => target.sourceOutputVersionId)).size !== targets.length) {
    throw new Error("A source version can appear only once.")
  }
  return { requestId, selectionMethod, scopeId, instructions, targets }
}

export function protectedGeometryForChain(chain: EditStep[]): ProtectedGeometry {
  return chain.some((step) => EXTERIOR_EDIT_TYPES.has(step.edit_type)) ? "exterior" : "interior"
}

export function protectedGeometryLabel(geometry: ProtectedGeometry) {
  return geometry === "exterior"
    ? "House structure, openings, driveway, lot, and camera stay fixed"
    : "Room dimensions, openings, floors, ceiling, and camera stay fixed"
}

export function scopedReworkCostCents(sources: ScopedReworkSource[]) {
  return sources.reduce((sum, source) => {
    if (!Number.isFinite(source.providerCostCents) || source.providerCostCents < 0) {
      throw new Error("A selected result has an invalid generation cost.")
    }
    return sum + source.providerCostCents
  }, 0)
}

export function buildScopedReworkSnapshot(
  input: ScopedReworkInput,
  sources: ScopedReworkSource[]
): ScopedReworkSnapshot {
  if (sources.length !== input.targets.length) throw new Error("The displayed target scope changed.")
  const sourceByVersion = new Map(sources.map((source) => [source.sourceOutputVersionId, source]))
  const ordered = input.targets.map((target) => {
    const source = sourceByVersion.get(target.sourceOutputVersionId)
    if (!source || source.sourcePhotoId !== target.sourcePhotoId) {
      throw new Error("A selected source version no longer matches its photo.")
    }
    return { target, source }
  })
  if (input.selectionMethod === "room" && ordered.some(({ source }) => source.roomId !== input.scopeId)) {
    throw new Error("Every target must still belong to the displayed room.")
  }
  if (
    input.selectionMethod === "same_room_group" &&
    ordered.some(({ source }) => source.sameRoomGroupId !== input.scopeId)
  ) {
    throw new Error("Every target must still belong to the displayed same-room group.")
  }
  const initialGenerationCostCents = scopedReworkCostCents(ordered.map(({ source }) => source))
  return {
    schemaVersion: SCOPED_REWORK_VERSION,
    selectionMethod: input.selectionMethod,
    scopeId: input.scopeId,
    sharedCorrection: input.instructions,
    targetCount: ordered.length,
    requestedGenerationCount: ordered.length,
    initialGenerationCostCents,
    targets: ordered.map(({ target, source }, position) => ({
      position,
      sourcePhotoId: source.sourcePhotoId,
      sourceOutputVersionId: source.sourceOutputVersionId,
      sourceFileGroupId: source.sourceFileGroupId,
      roomId: source.roomId,
      sameRoomGroupId: source.sameRoomGroupId,
      protectedGeometry: protectedGeometryForChain(source.editChain),
      exception: target.exception,
    })),
  }
}

