export const HDR_MAX_CAPTURE_GAP_MS = 2500
export const HDR_MIN_EXPOSURE_SPAN_EV = 1
export const HDR_MIN_LUMINANCE_SPAN = 0.12

export type HdrCandidatePhoto = {
  id: string
  sourceBatchId: string | null
  intakeOrder: number | null
  capturedAt: string | null
  width: number | null
  height: number | null
  exposureTimeSeconds: number | null
  exposureBiasEv: number | null
  apertureFNumber: number | null
  iso: number | null
  focalLengthMm: number | null
  cameraMake: string | null
  cameraModel: string | null
  lensModel: string | null
  luminance?: number | null
}
export type HdrProposal = {
  memberPhotoIds: string[]
  confidence: number
  reason: string
}

function exposureValue(photo: HdrCandidatePhoto) {
  if (photo.exposureBiasEv !== null) return photo.exposureBiasEv
  if (
    photo.exposureTimeSeconds &&
    photo.apertureFNumber &&
    photo.iso &&
    photo.exposureTimeSeconds > 0 &&
    photo.apertureFNumber > 0 &&
    photo.iso > 0
  ) {
    return (
      Math.log2((photo.apertureFNumber * photo.apertureFNumber) / photo.exposureTimeSeconds) -
      Math.log2(photo.iso / 100)
    )
  }
  return null
}

function sameCamera(a: HdrCandidatePhoto, b: HdrCandidatePhoto) {
  const same = (left: string | null, right: string | null) =>
    !left || !right || left.trim().toLowerCase() === right.trim().toLowerCase()
  return same(a.cameraMake, b.cameraMake) && same(a.cameraModel, b.cameraModel) && same(a.lensModel, b.lensModel)
}

function sameFrame(a: HdrCandidatePhoto, b: HdrCandidatePhoto) {
  if (!a.width || !a.height || !b.width || !b.height) return false
  if (Math.abs(a.width - b.width) > 2 || Math.abs(a.height - b.height) > 2) return false
  if (a.focalLengthMm && b.focalLengthMm) {
    const delta = Math.abs(a.focalLengthMm - b.focalLengthMm) / Math.max(a.focalLengthMm, b.focalLengthMm)
    if (delta > 0.02) return false
  }
  return sameCamera(a, b)
}

function capturedMs(photo: HdrCandidatePhoto) {
  if (!photo.capturedAt) return null
  const value = Date.parse(photo.capturedAt)
  return Number.isFinite(value) ? value : null
}

function evaluateBurst(burst: HdrCandidatePhoto[]): HdrProposal | null {
  if (burst.length < 3 || burst.length > 9) return null
  const exposures = burst.map(exposureValue)
  const knownExposures = exposures.filter((value): value is number => value !== null)
  const uniqueExposures = new Set(knownExposures.map((value) => Math.round(value * 10) / 10))
  const exposureSpan = knownExposures.length
    ? Math.max(...knownExposures) - Math.min(...knownExposures)
    : 0
  const times = burst.map(capturedMs).filter((value): value is number => value !== null)
  const duration = times.length === burst.length ? Math.max(...times) - Math.min(...times) : null

  if (knownExposures.length === burst.length && uniqueExposures.size >= 3 && exposureSpan >= HDR_MIN_EXPOSURE_SPAN_EV) {
    const confidence = duration !== null && duration <= 5000 ? 0.96 : 0.86
    return {
      memberPhotoIds: burst.map((photo) => photo.id),
      confidence,
      reason: `${burst.length} consecutive frames share dimensions and camera/lens metadata; exposure settings span ${exposureSpan.toFixed(1)} EV${duration === null ? "" : ` in ${(duration / 1000).toFixed(1)}s`}.`,
    }
  }

  const luminance = burst.map((photo) => photo.luminance).filter((value): value is number => value !== null && value !== undefined)
  if (duration !== null && luminance.length === burst.length) {
    const span = Math.max(...luminance) - Math.min(...luminance)
    if (span >= HDR_MIN_LUMINANCE_SPAN) {
      return {
        memberPhotoIds: burst.map((photo) => photo.id),
        confidence: 0.58,
        reason: `${burst.length} same-frame captures occurred within ${(duration / 1000).toFixed(1)}s and brightness varies across the set, but exposure metadata is incomplete. Review required.`,
      }
    }
  }
  return null
}

export function detectHdrGroups(photos: HdrCandidatePhoto[]): HdrProposal[] {
  const batches = new Map<string, HdrCandidatePhoto[]>()
  for (const photo of photos) {
    if (!photo.sourceBatchId || !photo.capturedAt || !photo.width || !photo.height) continue
    const list = batches.get(photo.sourceBatchId) ?? []
    list.push(photo)
    batches.set(photo.sourceBatchId, list)
  }

  const proposals: HdrProposal[] = []
  for (const batch of batches.values()) {
    const sorted = [...batch].sort((a, b) => (a.intakeOrder ?? 0) - (b.intakeOrder ?? 0))
    let burst: HdrCandidatePhoto[] = []
    const flush = () => {
      const proposal = evaluateBurst(burst)
      if (proposal) proposals.push(proposal)
      burst = []
    }
    for (const photo of sorted) {
      const previous = burst.at(-1)
      if (!previous) {
        burst.push(photo)
        continue
      }
      const currentTime = capturedMs(photo)
      const previousTime = capturedMs(previous)
      const adjacent =
        currentTime !== null &&
        previousTime !== null &&
        currentTime >= previousTime &&
        currentTime - previousTime <= HDR_MAX_CAPTURE_GAP_MS
      if (adjacent && sameFrame(previous, photo) && burst.length < 9) burst.push(photo)
      else {
        flush()
        burst.push(photo)
      }
    }
    flush()
  }
  return proposals
}

export function logicalPhotoIds<T extends { id: string; is_floor_plan: boolean; photo_role?: string }>(
  photos: T[],
  confirmedGroups: Array<{ representative_photo_id: string | null; members: string[] }>
) {
  const hiddenMembers = new Set(confirmedGroups.flatMap((group) => group.members))
  const representatives = new Set(
    confirmedGroups.map((group) => group.representative_photo_id).filter((id): id is string => Boolean(id))
  )
  return photos
    .filter(
      (photo) =>
        !photo.is_floor_plan &&
        !hiddenMembers.has(photo.id) &&
        (photo.photo_role !== "hdr_merged" || representatives.has(photo.id))
    )
    .map((photo) => photo.id)
}
