import assert from "node:assert/strict"
import { deriveJobDisplayStatus, deriveListingStatus } from "../lib/listing-status.ts"

let assertions = 0
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message)
  assertions += 1
}
function includes(actual, expected, message) {
  assert.match(actual, expected, message)
  assertions += 1
}

const base = {
  listingId: "listing-49",
  uploadItems: [],
  photoGroups: [],
  roomAnalysisRuns: [],
  roomProposals: [],
  jobs: [],
}

const empty = deriveListingStatus(base)
equal(empty.headline, "No active work", "an empty listing does not claim completion")
equal(empty.total, 0, "empty totals reconcile")

const mixed = deriveListingStatus({
  ...base,
  uploadItems: [
    { id: "up-active", originalFilename: "front.heic", status: "reserved" },
    { id: "up-failed", originalFilename: "kitchen.jpg", status: "failed", error: "Connection stopped" },
    { id: "up-done", originalFilename: "done.jpg", status: "complete" },
    { id: "up-canceled", originalFilename: "skip.jpg", status: "canceled" },
  ],
  photoGroups: [{ id: "hdr", state: "proposed", memberCount: 3 }],
  roomAnalysisRuns: [
    { id: "old-failure", status: "failed", error: "old", createdAt: "2026-08-31T10:00:00Z" },
    { id: "current", status: "complete", createdAt: "2026-09-01T10:00:00Z" },
  ],
  roomProposals: [
    { id: "room-1", photoId: "photo-1", photoLabel: "living.jpg", reviewState: "needs_review", decision: "pending" },
    { id: "room-2", photoId: "photo-2", reviewState: "confirmed", decision: "accepted" },
  ],
  jobs: [
    {
      id: "job",
      title: "stage rooms",
      status: "partial_failure",
      fileGroups: [
        { id: "queued", stepStatus: "queued", outputVersions: [] },
        { id: "running", stepStatus: "running", outputVersions: [] },
        { id: "failed", stepStatus: "failed", lastError: "Provider timed out", outputVersions: [] },
        { id: "ready", stepStatus: "complete", outputVersions: [{ id: "v1", versionNumber: 1, accessible: true }] },
      ],
    },
  ],
})

equal(mixed.counts, {
  uploading: 1,
  organizing: 2,
  queued: 1,
  editing: 1,
  review_pending: 1,
  needs_attention: 2,
}, "mixed durable rows map once into exact actionable buckets")
equal(mixed.total, 8, "count total equals drill-through item total")
equal(mixed.headline, "Needs attention", "failure wins the listing headline without hiding active work")
equal(mixed.items.some((item) => item.key === "upload:up-done"), false, "completed uploads are not actionable work")
equal(mixed.items.some((item) => item.key === "room-run:old-failure"), false, "a stale room-analysis failure does not override the latest run")
includes(mixed.items.find((item) => item.key === "upload:up-failed")?.href ?? "", /#upload-queue$/, "upload recovery links to its owning surface")
includes(mixed.items.find((item) => item.key === "hdr:hdr")?.href ?? "", /#shoot-organization$/, "HDR review links to shoot organization")
includes(mixed.items.find((item) => item.key === "room-proposal:room-1")?.href ?? "", /#room-organization$/, "room review links to organization")
includes(mixed.items.find((item) => item.key === "file-group:failed")?.href ?? "", /\/f\/failed$/, "generation recovery links to the exact workspace")

const partial = deriveListingStatus({
  ...base,
  roomAnalysisRuns: [{ id: "partial", status: "partial", error: "2 photos need manual review", createdAt: "2026-09-01T10:00:00Z" }],
  jobs: [{
    id: "partial-job",
    title: "enhance shoot",
    status: "processing",
    fileGroups: [
      { id: "done", stepStatus: "complete", outputVersions: [{ id: "v1", versionNumber: 1, accessible: true }] },
      { id: "active", stepStatus: "running", outputVersions: [] },
    ],
  }],
})
equal(partial.counts.review_pending, 1, "a finished result is reviewable while its batch continues")
equal(partial.counts.editing, 1, "a sibling keeps editing independently")
equal(partial.counts.needs_attention, 1, "partial organization remains visible as recovery work")

const inaccessible = deriveListingStatus({
  ...base,
  jobs: [{
    id: "signed",
    title: "enhance",
    status: "complete",
    fileGroups: [{ id: "missing", stepStatus: "complete", outputVersions: [{ id: "v2", versionNumber: 2, accessible: false }] }],
  }],
})
equal(inaccessible.counts.review_pending, 0, "an unavailable result is not presented as ready to review")
equal(inaccessible.counts.needs_attention, 1, "signed-image recovery is an explicit attention item")
equal(inaccessible.items[0].action, "Recover image", "signed-image failure names the recovery action")

const recovered = deriveListingStatus({
  ...base,
  jobs: [{
    id: "signed",
    title: "enhance",
    status: "complete",
    fileGroups: [{ id: "missing", stepStatus: "complete", outputVersions: [{ id: "v2", versionNumber: 2, accessible: true }] }],
  }],
})
equal(recovered.headline, "Review pending", "reload derives recovered output truth without a stored listing state")
equal(recovered.counts.review_pending, 1, "recovered image returns to review immediately")

const approved = deriveListingStatus({
  ...base,
  approvedSourcePhotoIds: ["photo-final"],
  jobs: [{
    id: "approved-job",
    title: "enhance",
    status: "complete",
    fileGroups: [{ id: "approved", primaryPhotoId: "photo-final", stepStatus: "complete", outputVersions: [{ id: "v3", versionNumber: 3, accessible: true }] }],
  }],
})
equal(approved.counts.review_pending, 0, "an explicitly approved logical source is no longer review pending")
equal(approved.headline, "No active work", "approved work leaves no false active workflow item")

const orphan = deriveListingStatus({
  ...base,
  jobs: [{ id: "orphan", title: "prepare edits", status: "pending", fileGroups: [] }],
})
equal(orphan.counts.queued, 1, "a durable pending job with no groups cannot make the listing look idle")

equal(deriveJobDisplayStatus([
  { stepStatus: "complete", outputCount: 1 },
  { stepStatus: "failed", outputCount: 0 },
], "complete").label, "Needs attention", "a stale complete parent cannot hide a failed child")
equal(deriveJobDisplayStatus([
  { stepStatus: "complete", outputCount: 1 },
  { stepStatus: "running", outputCount: 0 },
], "complete").label, "Editing", "partial batches stay active while finished siblings remain reviewable")
equal(deriveJobDisplayStatus([
  { stepStatus: "complete", outputCount: 1 },
], "complete").label, "Review pending", "finished work is not approval")
equal(deriveJobDisplayStatus([
  { stepStatus: "complete", outputCount: 1, approved: true },
], "complete").label, "Approved final", "explicit final selection changes the completed activity label")

console.log(`listing status: ${assertions} assertions passed`)
