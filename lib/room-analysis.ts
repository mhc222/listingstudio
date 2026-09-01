export const ROOM_ANALYSIS_HIGH_CONFIDENCE = 0.8
export const ROOM_ANALYSIS_MAX_PHOTOS = 100

// Kept explicit so the parser remains dependency-free in the contract harness.
// The static test compares this prompt/parser contract to the Postgres enum.
const VALID_ROOM_TYPES = new Set([
  "living_room",
  "kitchen",
  "dining",
  "main_bedroom",
  "bedroom_2",
  "bedroom_3",
  "bedroom_4",
  "bathroom_ensuite",
  "office",
  "outdoor_patio",
  "other",
])

export type RoomAnalysisProposal = {
  photoId: string
  roomType: string
  roomName: string
  existingRoomId: string | null
  sameRoomKey: string | null
  confidence: number
  evidence: string
  reviewState: "suggested" | "needs_review" | "untagged"
}

export type RoomAnalysisParseResult = {
  proposals: RoomAnalysisProposal[]
  missingPhotoIds: string[]
  rejected: string[]
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("room analysis returned no JSON object")
  return JSON.parse(text.slice(start, end + 1))
}

function shortText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""
}

function normalizedKey(value: unknown) {
  const key = shortText(value, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
  return key || null
}

export function parseRoomAnalysisResponse(
  text: string,
  expectedPhotoIds: string[],
  existingRoomIds: string[]
): RoomAnalysisParseResult {
  const expected = new Set(expectedPhotoIds)
  const existing = new Set(existingRoomIds)
  const seen = new Set<string>()
  const rejected: string[] = []
  const parsed = extractJson(text) as { photos?: unknown }
  const rows = Array.isArray(parsed?.photos) ? parsed.photos : []
  const provisional: RoomAnalysisProposal[] = []

  rows.forEach((value, index) => {
    const row = (value ?? {}) as Record<string, unknown>
    const photoId = shortText(row.photo_id, 80)
    if (!expected.has(photoId)) {
      rejected.push(`row ${index + 1}: unknown photo_id`)
      return
    }
    if (seen.has(photoId)) {
      rejected.push(`row ${index + 1}: duplicate photo_id ${photoId}`)
      return
    }
    seen.add(photoId)

    const roomType = shortText(row.room_type, 40)
    const roomName = shortText(row.room_name, 80)
    const evidence = shortText(row.evidence, 280)
    const confidence = typeof row.confidence === "number" ? row.confidence : Number.NaN
    if (!VALID_ROOM_TYPES.has(roomType) || !roomName || !evidence || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      rejected.push(`row ${index + 1}: invalid proposal fields for ${photoId}`)
      return
    }

    const requestedRoomId = shortText(row.existing_room_id, 80) || null
    const existingRoomId = requestedRoomId && existing.has(requestedRoomId) ? requestedRoomId : null
    provisional.push({
      photoId,
      roomType,
      roomName,
      existingRoomId,
      sameRoomKey: normalizedKey(row.same_room_key),
      confidence,
      evidence,
      reviewState:
        roomType === "other"
          ? "needs_review"
          : confidence >= ROOM_ANALYSIS_HIGH_CONFIDENCE
            ? "suggested"
            : "needs_review",
    })
  })

  // A same-room key on only one valid response is not a group. Removing it
  // avoids persisting a false singleton scope primitive.
  const keyCounts = new Map<string, number>()
  for (const proposal of provisional) {
    if (proposal.sameRoomKey) keyCounts.set(proposal.sameRoomKey, (keyCounts.get(proposal.sameRoomKey) ?? 0) + 1)
  }
  const proposals = provisional.map((proposal) => ({
    ...proposal,
    sameRoomKey:
      proposal.sameRoomKey && (keyCounts.get(proposal.sameRoomKey) ?? 0) >= 2
        ? proposal.sameRoomKey
        : null,
  }))

  return {
    proposals,
    missingPhotoIds: expectedPhotoIds.filter((id) => !proposals.some((proposal) => proposal.photoId === id)),
    rejected,
  }
}

export function roomAnalysisUserPrompt(
  photoIds: string[],
  rooms: Array<{ id: string; name: string; roomType: string }>
) {
  const candidates = rooms.length
    ? rooms.map((room) => `${room.id} | ${room.name} | ${room.roomType}`).join("\n")
    : "None."
  return [
    `Analyze ${photoIds.length} representative photos in the exact supplied order.`,
    `Photo IDs in order:\n${photoIds.map((id, index) => `${index + 1}. ${id}`).join("\n")}`,
    `Existing room candidates (ID | name | canonical type):\n${candidates}`,
    "Return the required JSON only. Existing room dimensions are intentionally omitted and must not be inferred from the photos.",
  ].join("\n\n")
}
