import type { SupabaseClient } from "@supabase/supabase-js"
import heicConvert from "heic-convert"
import sharp from "sharp"
import { MAX_UPLOAD_FILE_BYTES } from "@/config/uploads"
import { copy, download, info, upload } from "@/lib/storage"
import { extractSourcePhotoMetadata, type SourcePhotoMetadata } from "@/lib/photo-metadata"

export type IntakeItem = {
  id: string
  photo_id: string
  listing_id: string
  original_filename: string
  declared_content_type: string
  declared_byte_size: number
  source_extension: "jpg" | "png" | "webp" | "heic" | "heif" | "pdf"
  is_floor_plan: boolean
  intake_path: string
  source_storage_path: string
  canonical_storage_path: string | null
  source_content_type: string | null
  canonical_content_type: string | null
  source_byte_size: number | null
  width: number | null
  height: number | null
  status: "reserved" | "finalizing" | "complete" | "failed" | "canceled"
}

export type MaterializedIntake = {
  sourceStoragePath: string
  canonicalStoragePath: string
  sourceContentType: string
  canonicalContentType: string
  sourceByteSize: number
  width: number | null
  height: number | null
  photoMetadata: SourcePhotoMetadata
}

const EMPTY_PHOTO_METADATA: SourcePhotoMetadata = {
  capturedAt: null,
  exposureTimeSeconds: null,
  exposureBiasEv: null,
  apertureFNumber: null,
  iso: null,
  focalLengthMm: null,
  cameraMake: null,
  cameraModel: null,
  lensModel: null,
  sourceMetadata: {},
}

export function intakePath(
  userId: string,
  listingId: string,
  batchId: string,
  itemId: string,
  extension: string
) {
  return `${userId}/${listingId}/${batchId}/${itemId}/source.${extension}`
}

export function sourcePath(
  userId: string,
  listingId: string,
  photoId: string,
  extension: string
) {
  return `${userId}/${listingId}/${photoId}/source.${extension}`
}

export function canonicalPath(
  userId: string,
  listingId: string,
  photoId: string,
  extension: string
) {
  return `${userId}/${listingId}/${photoId}/canonical.${extension}`
}

function sniffContentType(bytes: Buffer) {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png"
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf"
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii").toLowerCase()
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic"
    if (["heif", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heif"
  }
  return null
}

function contentTypeMatches(declared: string, actual: string) {
  const heifFamily = new Set(["image/heic", "image/heif"])
  return declared === actual || (heifFamily.has(declared) && heifFamily.has(actual))
}

async function ensureSourceCopy(
  intakeStoragePath: string,
  finalStoragePath: string,
  expectedSize: number,
  admin: SupabaseClient
) {
  try {
    await copy("intake", intakeStoragePath, "originals", finalStoragePath, admin)
  } catch (copyError) {
    try {
      const existing = await info("originals", finalStoragePath, admin)
      if (existing.size !== expectedSize) throw copyError
    } catch {
      throw copyError
    }
  }
}

async function ensureCanonicalUpload(
  path: string,
  body: Buffer,
  contentType: string,
  admin: SupabaseClient
) {
  try {
    await upload("originals", path, body, contentType, admin)
  } catch (uploadError) {
    try {
      const existing = await info("originals", path, admin)
      if (existing.size !== body.byteLength || existing.contentType !== contentType) {
        throw uploadError
      }
    } catch {
      throw uploadError
    }
  }
}

export async function materializeIntakeItem(
  item: IntakeItem,
  admin: SupabaseClient
): Promise<MaterializedIntake> {
  const staged = await info("intake", item.intake_path, admin)
  const sourceByteSize = staged.size
  if (!sourceByteSize || sourceByteSize > MAX_UPLOAD_FILE_BYTES) {
    throw new Error("stored file is empty or exceeds the 50 MB limit")
  }
  if (sourceByteSize !== item.declared_byte_size) {
    throw new Error(
      `stored file size (${sourceByteSize}) does not match declared size (${item.declared_byte_size})`
    )
  }

  const blob = await download("intake", item.intake_path, admin)
  const sourceBuffer = Buffer.from(await blob.arrayBuffer())
  const sourceContentType = sniffContentType(sourceBuffer)
  if (!sourceContentType || !contentTypeMatches(item.declared_content_type, sourceContentType)) {
    throw new Error("stored file contents do not match the declared file type")
  }
  if (sourceContentType === "application/pdf" && !item.is_floor_plan) {
    throw new Error("PDFs are accepted only as floor plans")
  }

  await ensureSourceCopy(
    item.intake_path,
    item.source_storage_path,
    sourceByteSize,
    admin
  )

  if (sourceContentType === "application/pdf") {
    return {
      sourceStoragePath: item.source_storage_path,
      canonicalStoragePath: item.source_storage_path,
      sourceContentType,
      canonicalContentType: sourceContentType,
      sourceByteSize,
      width: null,
      height: null,
      photoMetadata: EMPTY_PHOTO_METADATA,
    }
  }

  const photoMetadata = await extractSourcePhotoMetadata(sourceBuffer)

  let canonicalBuffer = sourceBuffer
  let canonicalContentType = sourceContentType
  let canonicalExtension = item.source_extension

  if (sourceContentType === "image/heic" || sourceContentType === "image/heif") {
    canonicalBuffer = Buffer.from(
      await heicConvert({ buffer: sourceBuffer, format: "JPEG", quality: 0.9 })
    )
    canonicalContentType = "image/jpeg"
    canonicalExtension = "jpg"
  }

  let metadata = await sharp(canonicalBuffer).metadata()
  const mustNormalize =
    sourceContentType === "image/heic" ||
    sourceContentType === "image/heif" ||
    (metadata.orientation ?? 1) > 1

  if ((metadata.orientation ?? 1) > 1) {
    canonicalBuffer = await sharp(canonicalBuffer).rotate().toBuffer()
    metadata = await sharp(canonicalBuffer).metadata()
  }

  const finalCanonicalPath = mustNormalize
    ? canonicalPath(
        item.source_storage_path.split("/")[0],
        item.listing_id,
        item.photo_id,
        canonicalExtension
      )
    : item.source_storage_path

  if (mustNormalize) {
    await ensureCanonicalUpload(
      finalCanonicalPath,
      canonicalBuffer,
      canonicalContentType,
      admin
    )
  }

  return {
    sourceStoragePath: item.source_storage_path,
    canonicalStoragePath: finalCanonicalPath,
    sourceContentType,
    canonicalContentType,
    sourceByteSize,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    photoMetadata,
  }
}
