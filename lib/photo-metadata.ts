import sharp from "sharp"

export type SourcePhotoMetadata = {
  capturedAt: string | null
  exposureTimeSeconds: number | null
  exposureBiasEv: number | null
  apertureFNumber: number | null
  iso: number | null
  focalLengthMm: number | null
  cameraMake: string | null
  cameraModel: string | null
  lensModel: string | null
  sourceMetadata: Record<string, unknown>
}
const TYPE_BYTES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

function tiffStart(bytes: Buffer) {
  const exif = bytes.indexOf(Buffer.from("Exif\0\0", "binary"))
  if (exif >= 0) return exif + 6
  for (let i = 0; i <= Math.min(bytes.length - 4, 64); i++) {
    const marker = bytes.subarray(i, i + 4)
    if (marker.equals(Buffer.from([0x49, 0x49, 0x2a, 0x00]))) return i
    if (marker.equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) return i
  }
  return -1
}

function readExif(bytes: Buffer) {
  const start = tiffStart(bytes)
  if (start < 0 || start + 8 > bytes.length) return new Map<number, unknown>()
  const little = bytes[start] === 0x49 && bytes[start + 1] === 0x49
  const big = bytes[start] === 0x4d && bytes[start + 1] === 0x4d
  if (!little && !big) return new Map<number, unknown>()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (offset: number) => view.getUint16(offset, little)
  const u32 = (offset: number) => view.getUint32(offset, little)
  const i32 = (offset: number) => view.getInt32(offset, little)
  const inBounds = (offset: number, size: number) => offset >= 0 && offset + size <= bytes.length

  function valueAt(entry: number, type: number, count: number) {
    const unit = TYPE_BYTES[type]
    if (!unit || count < 1 || count > 1024) return null
    const size = unit * count
    const relative = size <= 4 ? entry + 8 : start + u32(entry + 8)
    if (!inBounds(relative, size)) return null
    if (type === 2) {
      return bytes.subarray(relative, relative + size).toString("utf8").replace(/\0+$/, "").trim()
    }
    const values: number[] = []
    for (let i = 0; i < count; i++) {
      const at = relative + i * unit
      if (type === 3) values.push(u16(at))
      else if (type === 4) values.push(u32(at))
      else if (type === 9) values.push(i32(at))
      else if (type === 5 || type === 10) {
        const numerator = type === 10 ? i32(at) : u32(at)
        const denominator = type === 10 ? i32(at + 4) : u32(at + 4)
        values.push(denominator ? numerator / denominator : 0)
      } else values.push(bytes[at])
    }
    return count === 1 ? values[0] : values
  }

  const tags = new Map<number, unknown>()
  function readIfd(relativeOffset: number) {
    const offset = start + relativeOffset
    if (!inBounds(offset, 2)) return
    const count = u16(offset)
    if (count > 512 || !inBounds(offset + 2, count * 12)) return
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12
      const tag = u16(entry)
      const type = u16(entry + 2)
      const valueCount = u32(entry + 4)
      const value = valueAt(entry, type, valueCount)
      if (value !== null) tags.set(tag, value)
    }
  }

  const firstIfd = u32(start + 4)
  readIfd(firstIfd)
  const exifIfd = tags.get(0x8769)
  if (typeof exifIfd === "number") readIfd(exifIfd)
  return tags
}

function text(tags: Map<number, unknown>, tag: number) {
  const value = tags.get(tag)
  return typeof value === "string" && value ? value : null
}

function number(tags: Map<number, unknown>, tag: number) {
  const value = tags.get(tag)
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function captureIso(raw: string | null, offset: string | null) {
  if (!raw) return null
  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const suffix = offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : "Z"
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${suffix}`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export async function extractSourcePhotoMetadata(source: Buffer): Promise<SourcePhotoMetadata> {
  let exif: Buffer | null = null
  try {
    exif = (await sharp(source).metadata()).exif ?? null
  } catch {
    // The canonicalization path may still support this file. Missing EXIF is
    // inventory truth, not a finalization failure.
  }
  const tags = readExif(exif ?? source)
  const capturedRaw = text(tags, 0x9003) ?? text(tags, 0x9004) ?? text(tags, 0x0132)
  const offsetRaw = text(tags, 0x9011) ?? text(tags, 0x9012)
  const isoValue = number(tags, 0x8827)
  const values = {
    capturedAt: captureIso(capturedRaw, offsetRaw),
    exposureTimeSeconds: number(tags, 0x829a),
    exposureBiasEv: number(tags, 0x9204),
    apertureFNumber: number(tags, 0x829d),
    iso: isoValue === null ? null : Math.round(isoValue),
    focalLengthMm: number(tags, 0x920a),
    cameraMake: text(tags, 0x010f),
    cameraModel: text(tags, 0x0110),
    lensModel: text(tags, 0xa434),
  }
  return {
    ...values,
    sourceMetadata: {
      exif_present: tags.size > 0,
      captured_at_raw: capturedRaw,
      captured_at_offset: offsetRaw,
      naive_timestamp_assumption: capturedRaw && !offsetRaw ? "UTC-for-relative-ordering" : null,
    },
  }
}
