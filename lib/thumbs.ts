// Phase 56: grid thumbnails. A thumb is an additive derived object stored
// beside its source in the same bucket; it is never a version, never touches
// SpendLedger, and the source object is never modified.
import sharp from "sharp"

export const THUMB_WIDTH = 480
export const THUMB_QUALITY = 75
export const THUMB_FILENAME = "thumb.jpg"
const THUMB_SUFFIX = ".thumb.jpg"

// Stems that own their directory (one photo per `<photoId>/` folder in
// `originals`) map to `<photoId>/thumb.jpg`. Everything else (an output
// FileGroup folder holds many `step-N-rR.jpg` versions) keeps its stem:
// `<fgId>/step-N-rR.thumb.jpg`.
const SOLO_STEMS = new Set(["source", "canonical"])

export function isThumbPath(storagePath: string): boolean {
  const name = storagePath.slice(storagePath.lastIndexOf("/") + 1)
  return name === THUMB_FILENAME || name.endsWith(THUMB_SUFFIX)
}

export function thumbPathFor(storagePath: string): string {
  if (isThumbPath(storagePath)) return storagePath
  const slash = storagePath.lastIndexOf("/")
  const dir = slash === -1 ? "" : storagePath.slice(0, slash + 1)
  const name = storagePath.slice(slash + 1)
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  return SOLO_STEMS.has(stem) ? `${dir}${THUMB_FILENAME}` : `${dir}${stem}${THUMB_SUFFIX}`
}

// Pure merge used by getThumbUrls: prefer the signed thumb, fall back to the
// signed source, drop paths that have neither. Keyed by SOURCE path so callers
// swap getUrls -> getThumbUrls without touching their lookups.
export function mergeThumbUrls(
  sourcePaths: string[],
  signedThumbs: Record<string, string>,
  signedSources: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const path of sourcePaths) {
    const url = signedThumbs[thumbPathFor(path)] ?? signedSources[path]
    if (url) out[path] = url
  }
  return out
}

// Sharp strips metadata by default (no withMetadata), so EXIF orientation is
// baked in by rotate() and nothing else survives. Never enlarges.
export async function renderThumb(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .rotate()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
    .toBuffer()
}
