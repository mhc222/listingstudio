import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  parseRoomAnalysisResponse,
  roomAnalysisUserPrompt,
  ROOM_ANALYSIS_HIGH_CONFIDENCE,
} from "../lib/room-analysis.ts"
import { buildRoomAnalysisSheets } from "../lib/room-analysis-images.ts"

const photos = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"]
const roomId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const response = JSON.stringify({
  photos: [
    { photo_id: photos[0], room_type: "kitchen", room_name: "Kitchen", existing_room_id: roomId, same_room_key: "Kitchen East", confidence: 0.94, evidence: "Cabinetry, an island, and appliances are visible." },
    { photo_id: photos[1], room_type: "kitchen", room_name: "Kitchen", existing_room_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", same_room_key: "Kitchen East", confidence: 0.88, evidence: "The same island and cabinet finish appear from another angle." },
    { photo_id: photos[2], room_type: "other", room_name: "Transition space", existing_room_id: null, same_room_key: "singleton", confidence: 0.52, evidence: "Only a partial doorway and wall are visible." },
  ],
})
const parsed = parseRoomAnalysisResponse(response, photos, [roomId])
assert.equal(parsed.proposals.length, 3)
assert.equal(parsed.proposals[0].reviewState, "suggested")
assert.equal(parsed.proposals[1].existingRoomId, null, "model cannot invent an existing room match")
assert.equal(parsed.proposals[0].sameRoomKey, "kitchen-east")
assert.equal(parsed.proposals[1].sameRoomKey, "kitchen-east")
assert.equal(parsed.proposals[2].sameRoomKey, null, "singleton keys are not scope groups")
assert.equal(parsed.proposals[2].reviewState, "needs_review")
assert.deepEqual(parsed.missingPhotoIds, [])
assert.equal(ROOM_ANALYSIS_HIGH_CONFIDENCE, 0.8)

const partial = parseRoomAnalysisResponse(
  JSON.stringify({ photos: [
    { photo_id: photos[0], room_type: "kitchen", room_name: "Kitchen", existing_room_id: null, same_room_key: null, confidence: 1.4, evidence: "Visible cabinets." },
    { photo_id: photos[1], room_type: "living_room", room_name: "Living Room", existing_room_id: null, same_room_key: null, confidence: 0.79, evidence: "A sofa and media wall are visible." },
    { photo_id: photos[1], room_type: "living_room", room_name: "Duplicate", existing_room_id: null, same_room_key: null, confidence: 0.9, evidence: "Duplicate." },
  ] }),
  photos,
  []
)
assert.equal(partial.proposals.length, 1, "valid neighbors survive invalid model rows")
assert.deepEqual(partial.missingPhotoIds, [photos[0], photos[2]])
assert.equal(partial.rejected.length, 2)

const prompt = roomAnalysisUserPrompt(photos, [{ id: roomId, name: "Kitchen", roomType: "kitchen" }])
assert.match(prompt, /representative photos/)
assert.match(prompt, /dimensions are intentionally omitted/)

const pixel = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#ddd"/></svg>').toString("base64")}`
const sheets = await buildRoomAnalysisSheets([
  { id: photos[0], url: pixel },
  { id: photos[1], url: pixel },
  { id: photos[2], url: "data:text/plain,not-an-image" },
])
assert.equal(sheets.sheets.length, 1, "valid neighbors still produce a contact sheet")
assert.deepEqual(sheets.failedPhotoIds, [photos[2]], "unreadable photos are reported for partial analysis")

const migration = await readFile(new URL("../supabase/migrations/0011_room_proposals.sql", import.meta.url), "utf8")
const prompts = await readFile(new URL("../lib/prompts.ts", import.meta.url), "utf8")
const analyzeRoute = await readFile(new URL("../app/api/listings/[id]/room-analysis/route.ts", import.meta.url), "utf8")
const decisionsRoute = await readFile(new URL("../app/api/listings/[id]/room-analysis/decisions/route.ts", import.meta.url), "utf8")
const groupsRoute = await readFile(new URL("../app/api/listings/[id]/same-room-groups/route.ts", import.meta.url), "utf8")
for (const contract of [
  "room_analysis_runs", "room_proposals", "same_room_groups", "same_room_group_members",
  "is_current_logical_photo", "apply_room_proposal_decisions", "replace_same_room_group_members",
  "room_analysis_run_id", "service_role",
]) assert.match(migration, new RegExp(contract))
assert.match(prompts, /ROOM_ANALYSIS_SYSTEM/)
assert.match(prompts, /Never infer or report room dimensions/)
assert.match(prompts, /Never invent an ID/)
assert.match(analyzeRoute, /logicalPhotoIds/)
assert.match(analyzeRoute, /ROOM_ANALYSIS/)
assert.match(analyzeRoute, /room_analysis_run_id/)
assert.match(analyzeRoute, /idempotent/)
assert.match(analyzeRoute, /is_current: false/)
assert.match(decisionsRoute, /apply_room_proposal_decisions/)
assert.match(groupsRoute, /Tag the selected views to the same room first/)

console.log("Phase 46 room-analysis contract: 36 assertions passed")
