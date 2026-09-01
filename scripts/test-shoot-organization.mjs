import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { detectHdrGroups, logicalPhotoIds } from "../lib/hdr-groups.ts"

function photo(id, batch, order, second, exposure, extra = {}) {
  return {
    id,
    sourceBatchId: batch,
    intakeOrder: order,
    capturedAt: `2026-09-01T12:00:${String(second).padStart(2, "0")}.000Z`,
    width: 6000,
    height: 4000,
    exposureTimeSeconds: null,
    exposureBiasEv: exposure,
    apertureFNumber: 8,
    iso: 100,
    focalLengthMm: 24,
    cameraMake: "Canon",
    cameraModel: "R5",
    lensModel: "RF 15-35mm",
    ...extra,
  }
}

const three = [-2, 0, 2].map((ev, index) => photo(`three-${index}`, "batch-3", index + 1, index, ev))
const five = [-2, -1, 0, 1, 2].map((ev, index) => photo(`five-${index}`, "batch-5", index + 1, index, ev))
const nine = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((ev, index) => photo(`nine-${index}`, "batch-9", index + 1, index, ev))
const singles = [0, 0, 0].map((ev, index) => photo(`single-${index}`, "batch-singles", index + 1, index * 4, ev))
const fallback = [0.3, 0.5, 0.72].map((luminance, index) =>
  photo(`fallback-${index}`, "batch-fallback", index + 1, index, null, {
    exposureTimeSeconds: null,
    apertureFNumber: null,
    iso: null,
    luminance,
  })
)

const proposals = detectHdrGroups([...three, ...five, ...nine, ...singles, ...fallback])
assert.deepEqual(proposals.slice(0, 3).map((proposal) => proposal.memberPhotoIds.length), [3, 5, 9])
assert.equal(proposals.length, 4, "mixed singles must remain ungrouped")
assert.equal(proposals[0].confidence, 0.96)
assert.equal(proposals[3].confidence, 0.58, "luminance fallback must remain reviewable")

const logical = logicalPhotoIds(
  [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `source-${index}`, is_floor_plan: false, photo_role: "source" })),
    { id: "merged", is_floor_plan: false, photo_role: "hdr_merged" },
    { id: "plan", is_floor_plan: true, photo_role: "source" },
  ],
  [{ representative_photo_id: "merged", members: ["source-0", "source-1", "source-2"] }]
)
assert.deepEqual(logical, ["source-3", "source-4", "source-5", "merged"])

const migration = await readFile(new URL("../supabase/migrations/0010_shoot_organization.sql", import.meta.url), "utf8")
const hdrRoute = await readFile(new URL("../app/api/hdr-merge/route.ts", import.meta.url), "utf8")
const jobsRoute = await readFile(new URL("../app/api/jobs/route.ts", import.meta.url), "utf8")
for (const contract of [
  "source_batch_id", "captured_at", "exposure_time_seconds", "photo_groups",
  "photo_group_members", "representative_photo_id", "confirm_hdr_group",
  "replace_hdr_group_members", "dismiss_hdr_group", "reopen_hdr_group",
]) assert.match(migration, new RegExp(contract))
assert.doesNotMatch(hdrRoute, /formData\(/, "HDR route must not accept another multipart upload")
assert.match(hdrRoute, /photo_group_members/)
assert.match(hdrRoute, /confirm_hdr_group/)
assert.match(jobsRoute, /confirmed HDR stack counts as one photo/)

console.log("Phase 45 shoot-organization contract: 20 assertions passed")
