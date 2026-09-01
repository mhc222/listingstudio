export const MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024
export const MAX_UPLOAD_FILES = 100
export const UPLOAD_FILE_LIMIT_LABEL = "50 MB"

export const IMAGE_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const

export const FLOOR_PLAN_UPLOAD_TYPES = [...IMAGE_UPLOAD_TYPES, "application/pdf"] as const

export type UploadDeclaration = {
  name: string
  size: number
  type?: string
  isFloorPlan?: boolean
  roomId?: string | null
}

export type ValidatedUploadDeclaration = {
  originalFilename: string
  byteSize: number
  contentType: string
  extension: "jpg" | "png" | "webp" | "heic" | "heif" | "pdf"
  isFloorPlan: boolean
  roomId: string | null
}

const TYPE_EXTENSION = new Map<string, ValidatedUploadDeclaration["extension"]>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["application/pdf", "pdf"],
])

const EXTENSION_TYPE = new Map<string, string>([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["heic", "image/heic"],
  ["heif", "image/heif"],
  ["pdf", "application/pdf"],
])

function filenameExtension(name: string) {
  return name.trim().toLowerCase().split(".").pop() ?? ""
}

export function validateUploadDeclaration(
  input: UploadDeclaration
): ValidatedUploadDeclaration {
  const originalFilename = input.name?.trim()
  if (!originalFilename || originalFilename.length > 512) {
    throw new Error("filename must be between 1 and 512 characters")
  }
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    throw new Error(`${originalFilename}: file is empty or its size is invalid`)
  }
  if (input.size > MAX_UPLOAD_FILE_BYTES) {
    throw new Error(`${originalFilename}: exceeds the ${UPLOAD_FILE_LIMIT_LABEL} limit`)
  }

  const byExtension = EXTENSION_TYPE.get(filenameExtension(originalFilename))
  const declaredType = input.type?.trim().toLowerCase() || byExtension || ""
  const contentType = TYPE_EXTENSION.has(declaredType) ? declaredType : byExtension
  if (!contentType) throw new Error(`${originalFilename}: unsupported file type`)

  const extension = TYPE_EXTENSION.get(contentType)
  if (!extension) throw new Error(`${originalFilename}: unsupported file type`)

  const isFloorPlan = Boolean(input.isFloorPlan)
  if (contentType === "application/pdf" && !isFloorPlan) {
    throw new Error(`${originalFilename}: PDFs are accepted only as floor plans`)
  }
  if (!isFloorPlan && !IMAGE_UPLOAD_TYPES.includes(contentType as (typeof IMAGE_UPLOAD_TYPES)[number])) {
    throw new Error(`${originalFilename}: unsupported photo type`)
  }

  const roomId = input.roomId?.trim() || null
  if (roomId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roomId)) {
    throw new Error(`${originalFilename}: invalid room id`)
  }

  return {
    originalFilename,
    byteSize: input.size,
    contentType,
    extension,
    isFloorPlan,
    roomId,
  }
}
