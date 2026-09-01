import { createHash } from "node:crypto"

export const DELIVERY_FORMATS = ["jpeg", "webp", "png"] as const
export const DELIVERY_DISCLOSURES = ["watermark", "companion", "watermark_and_companion"] as const
export const DELIVERY_NAMING = ["sequence_room", "sequence_original", "original"] as const
export const DELIVERY_ORDERING = ["shoot", "room"] as const

export type DeliveryFormat = (typeof DELIVERY_FORMATS)[number]
export type DeliveryDisclosure = (typeof DELIVERY_DISCLOSURES)[number]
export type DeliveryNaming = (typeof DELIVERY_NAMING)[number]
export type DeliveryOrdering = (typeof DELIVERY_ORDERING)[number]

export type DeliveryProfileRow = {
  id: string
  name: string
  file_format: DeliveryFormat
  max_width: number | null
  max_height: number | null
  quality: number
  max_bytes: number | null
  disclosure_mode: DeliveryDisclosure
  naming_pattern: DeliveryNaming
  ordering: DeliveryOrdering
  created_at: string
  updated_at: string
}

export type DeliveryCandidate = {
  sourcePhotoId: string
  originalFilename: string
  roomName: string
  intakeOrder: number | null
  width: number | null
  height: number | null
  finalId: string | null
  selectedAt: string | null
  outputVersionId: string | null
  versionNumber: number | null
  reviewState: string | null
  qaNote: string | null
  compliance: { checks?: Array<{ id?: string; label?: string; pass?: boolean; note?: string }> } | null
  staged: boolean
  bucket: "originals" | "outputs"
  storagePath: string
  selectionIssue: string | null
}

export type DeliveryWarning = {
  id: string
  sourcePhotoId: string
  filename: string
  message: string
}

export type DeliveryPreviewEntry = {
  sourcePhotoId: string
  originalFilename: string
  roomName: string
  order: number
  source: "Untouched original" | "Edited result"
  version: string
  generatedFilename: string
  expectedDimensions: string
  expectedSize: string
  stagedDisclosure: string
}

export type DeliveryPreview = {
  listingId: string
  address: string
  profile: DeliveryProfileRow
  fingerprint: string
  included: DeliveryPreviewEntry[]
  omitted: Array<{ sourcePhotoId: string; originalFilename: string; reason: string }>
  warnings: DeliveryWarning[]
  blockingIssues: string[]
  canDownload: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function integerOrNull(value: unknown, label: string, min: number, max: number) {
  if (value === null || value === undefined || value === "") return null
  const number = typeof value === "string" ? Number(value) : value
  if (!Number.isInteger(number) || (number as number) < min || (number as number) > max) {
    throw new Error(`${label} must be a whole number from ${min.toLocaleString()} to ${max.toLocaleString()}.`)
  }
  return number as number
}

export function validateDeliveryProfileInput(raw: unknown) {
  if (!isRecord(raw)) throw new Error("Delivery profile details are required.")
  if (typeof raw.name !== "string") throw new Error("Profile name is required.")
  const name = raw.name.trim().replace(/\s+/g, " ")
  if (!name || name.length > 80) throw new Error("Profile name must be between 1 and 80 characters.")
  if (!DELIVERY_FORMATS.includes(raw.fileFormat as DeliveryFormat)) throw new Error("Choose a supported file format.")
  if (!DELIVERY_DISCLOSURES.includes(raw.disclosureMode as DeliveryDisclosure)) throw new Error("Choose a staging disclosure method.")
  if (!DELIVERY_NAMING.includes(raw.namingPattern as DeliveryNaming)) throw new Error("Choose a filename pattern.")
  if (!DELIVERY_ORDERING.includes(raw.ordering as DeliveryOrdering)) throw new Error("Choose a photo order.")

  const maxWidth = integerOrNull(raw.maxWidth, "Maximum width", 320, 12000)
  const maxHeight = integerOrNull(raw.maxHeight, "Maximum height", 320, 12000)
  const quality = integerOrNull(raw.quality, "Quality", 35, 100) ?? 88
  const maxMegabytes = raw.maxMegabytes === null || raw.maxMegabytes === undefined || raw.maxMegabytes === ""
    ? null
    : Number(raw.maxMegabytes)
  if (maxMegabytes !== null && (!Number.isFinite(maxMegabytes) || maxMegabytes < 0.25 || maxMegabytes > 20)) {
    throw new Error("Size ceiling must be from 0.25 MB to 20 MB.")
  }
  const maxBytes = maxMegabytes === null ? null : Math.floor(maxMegabytes * 1024 * 1024)
  if (maxWidth === null && maxHeight === null && maxBytes === null) {
    throw new Error("Set dimensions or a size ceiling so the package has an enforceable output limit.")
  }
  if (raw.fileFormat === "png" && maxBytes !== null) {
    throw new Error("PNG profiles use dimension limits; choose JPEG or WebP for a strict size ceiling.")
  }

  return {
    name,
    fileFormat: raw.fileFormat as DeliveryFormat,
    maxWidth,
    maxHeight,
    quality,
    maxBytes,
    disclosureMode: raw.disclosureMode as DeliveryDisclosure,
    namingPattern: raw.namingPattern as DeliveryNaming,
    ordering: raw.ordering as DeliveryOrdering,
  }
}

export function sanitizeFilenamePart(value: string, fallback = "photo") {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\.\.+/g, ".")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/[ .]+$/g, "")
    .replace(/^[ .-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 96)
  const safe = cleaned || fallback
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe) ? `_${safe}` : safe
}

function withoutExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, "")
}

function extension(format: DeliveryFormat) {
  return format === "jpeg" ? "jpg" : format
}

function baseName(candidate: DeliveryCandidate, pattern: DeliveryNaming, position: number) {
  const sequence = String(position).padStart(3, "0")
  const original = sanitizeFilenamePart(withoutExtension(candidate.originalFilename))
  const room = sanitizeFilenamePart(candidate.roomName, "untagged")
  if (pattern === "sequence_room") return `${sequence}-${room}`
  if (pattern === "sequence_original") return `${sequence}-${original}`
  return original
}

function orderedCandidates(candidates: DeliveryCandidate[], ordering: DeliveryOrdering) {
  return [...candidates].sort((a, b) => {
    if (ordering === "room") {
      const room = a.roomName.localeCompare(b.roomName, undefined, { sensitivity: "base" })
      if (room) return room
    }
    return (a.intakeOrder ?? Number.MAX_SAFE_INTEGER) - (b.intakeOrder ?? Number.MAX_SAFE_INTEGER)
      || a.originalFilename.localeCompare(b.originalFilename)
      || a.sourcePhotoId.localeCompare(b.sourcePhotoId)
  })
}

function expectedDimensions(candidate: DeliveryCandidate, profile: DeliveryProfileRow) {
  if (!candidate.width || !candidate.height) return "Calculated during package creation"
  const scale = Math.min(
    1,
    profile.max_width ? profile.max_width / candidate.width : 1,
    profile.max_height ? profile.max_height / candidate.height : 1
  )
  return `${Math.round(candidate.width * scale)} × ${Math.round(candidate.height * scale)} px`
}

function expectedSize(profile: DeliveryProfileRow) {
  if (!profile.max_bytes) return `Quality ${profile.quality}`
  return `At most ${(profile.max_bytes / 1024 / 1024).toFixed(profile.max_bytes % (1024 * 1024) ? 2 : 0)} MB`
}

function disclosureLabel(candidate: DeliveryCandidate, profile: DeliveryProfileRow) {
  if (!candidate.staged) return "Not required"
  if (profile.disclosure_mode === "watermark") return "Virtually Staged watermark"
  if (profile.disclosure_mode === "companion") return "Disclosure companion"
  return "Watermark + disclosure companion"
}

export function buildDeliveryPreview({
  listingId,
  address,
  profile,
  candidates,
}: {
  listingId: string
  address: string
  profile: DeliveryProfileRow
  candidates: DeliveryCandidate[]
}): DeliveryPreview {
  const ordered = orderedCandidates(candidates, profile.ordering)
  const omitted: DeliveryPreview["omitted"] = []
  const warnings: DeliveryWarning[] = []
  const blockingIssues: string[] = []
  const selectedVersions = new Set<string>()
  const includedCandidates: DeliveryCandidate[] = []

  for (const candidate of ordered) {
    if (!candidate.finalId) {
      omitted.push({
        sourcePhotoId: candidate.sourcePhotoId,
        originalFilename: candidate.originalFilename,
        reason: "No approved final",
      })
      continue
    }
    if (candidate.selectionIssue || !candidate.storagePath) {
      blockingIssues.push(candidate.selectionIssue || `${candidate.originalFilename} has an invalid final selection.`)
      continue
    }
    if (candidate.outputVersionId) {
      if (selectedVersions.has(candidate.outputVersionId)) {
        blockingIssues.push(`The same output was selected more than once (${candidate.originalFilename}).`)
        continue
      }
      selectedVersions.add(candidate.outputVersionId)
    }
    if (candidate.reviewState === "needs_changes") {
      blockingIssues.push(`${candidate.originalFilename} is both selected and marked Needs changes.`)
      continue
    }
    includedCandidates.push(candidate)
    if (candidate.qaNote) {
      warnings.push({
        id: `${candidate.sourcePhotoId}:qa`,
        sourcePhotoId: candidate.sourcePhotoId,
        filename: candidate.originalFilename,
        message: candidate.qaNote,
      })
    }
    for (const [index, check] of (candidate.compliance?.checks ?? []).entries()) {
      if (check.pass !== false) continue
      warnings.push({
        id: `${candidate.sourcePhotoId}:compliance:${check.id ?? index}`,
        sourcePhotoId: candidate.sourcePhotoId,
        filename: candidate.originalFilename,
        message: check.note || check.label || "A compliance check needs review.",
      })
    }
  }

  if (omitted.length) blockingIssues.push(`${omitted.length} photo${omitted.length === 1 ? " is" : "s are"} missing an approved final.`)
  if (includedCandidates.length === 0) blockingIssues.push("Approve at least one photo before creating a package.")

  const usedNames = new Map<string, number>()
  const included = includedCandidates.map((candidate, index) => {
    const base = baseName(candidate, profile.naming_pattern, index + 1)
    const key = base.toLowerCase()
    const collision = (usedNames.get(key) ?? 0) + 1
    usedNames.set(key, collision)
    const filename = `${base}${collision > 1 ? `-${collision}` : ""}.${extension(profile.file_format)}`
    return {
      sourcePhotoId: candidate.sourcePhotoId,
      originalFilename: candidate.originalFilename,
      roomName: candidate.roomName,
      order: index + 1,
      source: candidate.outputVersionId ? "Edited result" as const : "Untouched original" as const,
      version: candidate.outputVersionId ? `Version ${candidate.versionNumber ?? "?"}` : "Original",
      generatedFilename: filename,
      expectedDimensions: expectedDimensions(candidate, profile),
      expectedSize: expectedSize(profile),
      stagedDisclosure: disclosureLabel(candidate, profile),
    }
  })

  const fingerprint = createHash("sha256").update(JSON.stringify({
    listingId,
    profile: profile.id,
    profileUpdatedAt: profile.updated_at,
    finals: includedCandidates.map((candidate) => [candidate.sourcePhotoId, candidate.finalId, candidate.outputVersionId, candidate.selectedAt]),
    omitted: omitted.map((item) => item.sourcePhotoId),
  })).digest("hex")

  return {
    listingId,
    address,
    profile,
    fingerprint,
    included,
    omitted,
    warnings,
    blockingIssues,
    canDownload: blockingIssues.length === 0,
  }
}

export function packageBasename(address: string, profileName: string) {
  return `${sanitizeFilenamePart(address, "listing")}-${sanitizeFilenamePart(profileName, "delivery")}`
}
