import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { buildBatchScope, withConfirmedRoomStaging } from "../lib/batch-scope.ts"

let assertions = 0
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message)
  assertions += 1
}
function includes(actual, expected, message) {
  assert.match(actual, expected, message)
  assertions += 1
}

const stageLiving = [{ edit_type: "VIRTUAL_STAGING", options: { room_type: "living_room", furniture_style: "modern" } }]
const enhance = [{ edit_type: "IMAGE_ENHANCEMENT", options: {} }]
const livingA = { id: "a", roomId: "living", roomType: "living_room", roomName: "Living Room", sameRoomGroupId: "views", photoRole: "source", hdrGroupId: null }
const livingB = { id: "b", roomId: "living", roomType: "living_room", roomName: "Living Room", sameRoomGroupId: "views", photoRole: "hdr_merged", hdrGroupId: "hdr-1" }
const kitchen = { id: "c", roomId: "kitchen", roomType: "kitchen", roomName: "Kitchen", sameRoomGroupId: null, photoRole: "source", hdrGroupId: null }
const untagged = { id: "d", roomId: null, roomType: null, roomName: null, sameRoomGroupId: null, photoRole: "source", hdrGroupId: null }

const compatible = buildBatchScope({
  requestedPhotoIds: ["a", "b"], photos: [livingA, livingB], commonChain: stageLiving,
  selectionMethod: "same_room_group", outputSize: "under_10mb",
})
equal(compatible.ok, true, "one confirmed room can share its matching staging chain")
if (compatible.ok) {
  equal(compatible.snapshot.targetCount, 2, "snapshot records exact target count")
  equal(compatible.snapshot.roomIds, ["living"], "snapshot records room identity")
  equal(compatible.snapshot.sameRoomGroupIds, ["views"], "snapshot records same-room identity")
  equal(compatible.snapshot.outputSize, "under_10mb", "snapshot records output size")
  equal(compatible.snapshot.estimatedGenerationCount, 2, "snapshot records exact generation count")
  equal(compatible.snapshot.targets[1].photoRole, "hdr_merged", "logical HDR representative identity survives")
  equal(compatible.snapshot.targets[1].hdrGroupId, "hdr-1", "HDR lineage survives")
}

const mixedImplicit = buildBatchScope({
  requestedPhotoIds: ["a", "c"], photos: [livingA, kitchen], commonChain: stageLiving,
})
equal(mixedImplicit.ok, false, "mixed rooms reject one implicit staging chain")
if (!mixedImplicit.ok) includes(mixedImplicit.error, /different confirmed rooms/i, "mixed-room error is actionable")

const explicit = withConfirmedRoomStaging(["a", "c"], [livingA, kitchen], stageLiving)
equal(explicit[1].editChain[0].options?.room_type, "kitchen", "explicit target receives its confirmed room type")
const mixedExplicit = buildBatchScope({
  requestedPhotoIds: ["a", "c"], photos: [livingA, kitchen], commonChain: stageLiving,
  explicitTargets: explicit, selectionMethod: "manual",
})
equal(mixedExplicit.ok, true, "mixed rooms accept exact per-target room settings")
if (mixedExplicit.ok) {
  equal(mixedExplicit.snapshot.usesPerTargetOverrides, true, "snapshot declares per-target overrides")
  equal(mixedExplicit.snapshot.targets[1].editChain[0].options?.room_type, "kitchen", "snapshot persists per-target chain")
}

const forgedMismatch = buildBatchScope({
  requestedPhotoIds: ["a", "c"], photos: [livingA, kitchen], commonChain: stageLiving,
  explicitTargets: [explicit[1], explicit[0]],
})
equal(forgedMismatch.ok, false, "crafted reordered overrides are rejected")

const forgedWrongRoom = buildBatchScope({
  requestedPhotoIds: ["a", "c"], photos: [livingA, kitchen], commonChain: stageLiving,
  explicitTargets: [explicit[0], { photoId: "c", editChain: stageLiving }],
})
equal(forgedWrongRoom.ok, false, "crafted wrong per-target room type is rejected")

const untaggedBatch = buildBatchScope({
  requestedPhotoIds: ["a", "d"], photos: [livingA, untagged], commonChain: stageLiving,
  explicitTargets: withConfirmedRoomStaging(["a", "d"], [livingA, untagged], stageLiving),
})
equal(untaggedBatch.ok, false, "untagged staging target rejects even with a crafted override")
if (!untaggedBatch.ok) includes(untaggedBatch.error, /organize 1 untagged photo/i, "untagged error gives recovery")

const nonStaging = buildBatchScope({
  requestedPhotoIds: ["a", "c", "d"], photos: [livingA, kitchen, untagged], commonChain: enhance,
  selectionMethod: "visible", outputSize: "bogus",
})
equal(nonStaging.ok, true, "compatible non-staging batches do not require room tags")
if (nonStaging.ok) {
  equal(nonStaging.snapshot.outputSize, "original", "invalid output size normalizes safely")
  equal(nonStaging.snapshot.selectionMethod, "visible", "selection method persists")
  equal(nonStaging.snapshot.estimatedGenerationCount, 3, "generation count reconciles across targets")
}

const single = buildBatchScope({
  requestedPhotoIds: ["d"], photos: [untagged], commonChain: stageLiving, selectionMethod: "visible",
})
equal(single.ok, true, "single-photo staging behavior remains available")
if (single.ok) equal(single.snapshot.selectionMethod, "single", "single target scope cannot masquerade as batch selection")

const migration = readFileSync(new URL("../supabase/migrations/0013_batch_scope.sql", import.meta.url), "utf8")
includes(migration, /unique index jobs_listing_target_request_unique/i, "migration reserves one job per request identity")
includes(migration, /job target scope is immutable/i, "migration blocks scope mutation")

console.log(`batch scope: ${assertions} assertions passed`)
