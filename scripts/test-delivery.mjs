import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import JSZip from "jszip"
import {
  buildDeliveryPreview,
  packageBasename,
  sanitizeFilenamePart,
  validateDeliveryProfileInput,
} from "../lib/delivery.ts"
import { createStreamingZip } from "../lib/stream-zip.ts"

let assertions = 0
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message)
  assertions += 1
}
function matches(actual, expected, message) {
  assert.match(actual, expected, message)
  assertions += 1
}
function throws(fn, pattern, message) {
  assert.throws(fn, pattern, message)
  assertions += 1
}

const rawProfile = {
  name: "  MLS   delivery ", fileFormat: "jpeg", maxWidth: "3000", maxHeight: 3000,
  quality: "88", maxMegabytes: "10", disclosureMode: "watermark_and_companion",
  namingPattern: "sequence_room", ordering: "shoot",
}
const sanitized = validateDeliveryProfileInput(rawProfile)
equal(sanitized.name, "MLS delivery", "normalizes a named profile")
equal(sanitized.maxBytes, 10 * 1024 * 1024, "converts the size ceiling to bytes")
throws(() => validateDeliveryProfileInput({ ...rawProfile, fileFormat: "tiff" }), /supported file format/, "rejects unknown formats")
throws(() => validateDeliveryProfileInput({ ...rawProfile, fileFormat: "png", maxMegabytes: 5 }), /PNG profiles/, "rejects an unenforceable PNG byte ceiling")
throws(() => validateDeliveryProfileInput({ ...rawProfile, maxWidth: "", maxHeight: "", maxMegabytes: "" }), /dimensions or a size ceiling/, "requires an output limit")
equal(sanitizeFilenamePart("../../Kitchen: hero?.JPG"), "Kitchen-hero-.JPG", "removes traversal and reserved path characters")
equal(sanitizeFilenamePart("CON"), "_CON", "guards Windows reserved names")
equal(packageBasename("12 / Main St.", "MLS client"), "12-Main-St-MLS-client", "package name is traversal-safe")

const profile = {
  id: "profile", name: "MLS delivery", file_format: "jpeg", max_width: 3000, max_height: 3000,
  quality: 88, max_bytes: 10 * 1024 * 1024, disclosure_mode: "watermark_and_companion",
  naming_pattern: "sequence_room", ordering: "shoot", created_at: "2026-09-01", updated_at: "2026-09-01",
}
const base = {
  roomName: "Kitchen", intakeOrder: 1, width: 6000, height: 4000, finalId: "final-1",
  selectedAt: "2026-09-01T12:00:00Z", outputVersionId: "older-version", versionNumber: 1,
  reviewState: "approved", qaNote: null, compliance: null, staged: false,
  bucket: "outputs", storagePath: "older.jpg", selectionIssue: null,
}
const complete = buildDeliveryPreview({
  listingId: "listing", address: "12 Main St", profile,
  candidates: [
    { ...base, sourcePhotoId: "p1", originalFilename: "IMG_0001.jpg" },
    { ...base, sourcePhotoId: "p2", originalFilename: "IMG_0002.jpg", intakeOrder: 2, finalId: "final-2", outputVersionId: null, versionNumber: null, bucket: "originals", storagePath: "source.jpg" },
    { ...base, sourcePhotoId: "p3", originalFilename: "IMG_0003.jpg", intakeOrder: 3, finalId: "final-3", outputVersionId: "staged-v2", versionNumber: 2, staged: true, qaNote: "Check the window reflection." },
  ],
})
equal(complete.canDownload, true, "a full explicit-final set is downloadable")
equal(complete.included.map((item) => item.generatedFilename), ["001-Kitchen.jpg", "002-Kitchen.jpg", "003-Kitchen.jpg"], "sequence naming is deterministic and collision-free")
equal(complete.included[0].version, "Version 1", "an explicitly approved older revision is retained")
equal(complete.included[1].source, "Untouched original", "an explicitly approved original is retained")
equal(complete.included[2].stagedDisclosure, "Watermark + disclosure companion", "staged delivery is explicit")
equal(complete.warnings.length, 1, "QA warnings require acknowledgement")

const blocked = buildDeliveryPreview({
  listingId: "listing", address: "12 Main St", profile,
  candidates: [
    { ...base, sourcePhotoId: "p1", originalFilename: "approved.jpg" },
    { ...base, sourcePhotoId: "p2", originalFilename: "missing.jpg", finalId: null, outputVersionId: null, bucket: "originals", storagePath: "missing.jpg" },
  ],
})
equal(blocked.canDownload, false, "missing finals block the package")
equal(blocked.omitted[0].reason, "No approved final", "missing approval is visible, not silently replaced")
matches(blocked.blockingIssues.join(" "), /missing an approved final/, "blocker names missing finals")
const duplicate = buildDeliveryPreview({
  listingId: "listing", address: "12 Main St", profile,
  candidates: [
    { ...base, sourcePhotoId: "p1", originalFilename: "one.jpg" },
    { ...base, sourcePhotoId: "p2", originalFilename: "two.jpg", finalId: "final-2" },
  ],
})
equal(duplicate.canDownload, false, "a duplicated output selection blocks delivery")
matches(duplicate.blockingIssues.join(" "), /selected more than once/, "duplicate blocker names the invalid selection")
const changedProfile = { ...profile, updated_at: "2026-09-01T13:00:00Z" }
const changed = buildDeliveryPreview({ listingId: "listing", address: "12 Main St", profile: changedProfile, candidates: [{ ...base, sourcePhotoId: "p1", originalFilename: "IMG_0001.jpg" }] })
equal(changed.fingerprint === complete.fingerprint, false, "profile/final fingerprint changes invalidate stale previews")

let activeDataCalls = 0
let maxActiveDataCalls = 0
const zipStream = createStreamingZip(Array.from({ length: 12 }, (_, index) => ({
  name: `photo-${index + 1}.bin`,
  data: async () => {
    activeDataCalls += 1
    maxActiveDataCalls = Math.max(maxActiveDataCalls, activeDataCalls)
    const data = new Uint8Array(256 * 1024).fill(index)
    activeDataCalls -= 1
    return data
  },
})), new Date("2026-09-01T12:00:00Z"))
const reader = zipStream.getReader()
const chunks = []
let maxChunk = 0
for (;;) {
  const result = await reader.read()
  if (result.done) break
  maxChunk = Math.max(maxChunk, result.value.length)
  chunks.push(result.value)
}
const archiveBytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
let cursor = 0
for (const chunk of chunks) { archiveBytes.set(chunk, cursor); cursor += chunk.length }
equal(maxActiveDataCalls, 1, "archive materializes at most one source entry at a time")
equal(maxChunk <= 64 * 1024, true, "archive emits backpressured chunks no larger than 64 KiB")
const parsedZip = await JSZip.loadAsync(archiveBytes)
equal(Object.keys(parsedZip.files).length, 12, "streamed archive is readable and contains every entry")
equal((await parsedZip.file("photo-12.bin").async("uint8array"))[0], 11, "streamed archive preserves entry bytes")

let largeCalls = 0
let largeBytes = 0
let largeMaxChunk = 0
const largeStream = createStreamingZip(Array.from({ length: 64 }, (_, index) => ({
  name: `full-shoot-${index + 1}.bin`,
  data: async () => { largeCalls += 1; return new Uint8Array(1024 * 1024).fill(index) },
})))
const largeReader = largeStream.getReader()
for (;;) {
  const result = await largeReader.read()
  if (result.done) break
  largeBytes += result.value.length
  largeMaxChunk = Math.max(largeMaxChunk, result.value.length)
}
equal(largeCalls, 64, "a 64-photo fixture materializes every entry exactly once")
equal(largeBytes > 64 * 1024 * 1024, true, "bounded-stream fixture crosses 64 MB total output")
equal(largeMaxChunk <= 64 * 1024, true, "64 MB total output still emits at most 64 KiB per backpressured chunk")

const migration = readFileSync("supabase/migrations/0016_delivery_profiles.sql", "utf8")
const loader = readFileSync("lib/delivery-server.ts", "utf8")
const downloadRoute = readFileSync("app/api/listings/[id]/download-all/route.ts", "utf8")
const previewRoute = readFileSync("app/api/listings/[id]/delivery/route.ts", "utf8")
const workspace = readFileSync("app/listings/[id]/delivery/delivery-workspace.tsx", "utf8")
const deliveryPage = readFileSync("app/listings/[id]/delivery/page.tsx", "utf8")
const activity = readFileSync("app/listings/[id]/activity/page.tsx", "utf8")
for (const invariant of ["delivery_profiles", "user_id", "file_format", "max_bytes", "disclosure_mode", "naming_pattern", "ordering", "enable row level security", "read own delivery profiles"]) {
  matches(migration, new RegExp(invariant), `migration contains ${invariant}`)
}
matches(loader, /photo_finals/, "server preview is rooted in explicit photo finals")
matches(loader, /logicalPhotoIds/, "server preview uses the current logical-photo set")
matches(downloadRoute, /preview\.fingerprint !== expectedFingerprint/, "download rejects a stale preview")
matches(downloadRoute, /acknowledge.*preview\.fingerprint/, "download requires exact warning acknowledgement")
matches(downloadRoute, /createStreamingZip/, "download uses the bounded streaming archive")
matches(downloadRoute, /download\(candidate\.bucket, candidate\.storagePath, storageClient\)/, "archive reads only the recomputed exact-final storage path")
equal(/JSZip|generateAsync/.test(downloadRoute), false, "production archive does not use whole-package JSZip buffering")
matches(previewRoute, /loadDeliveryPackageContext/, "preview and download share one approved-set loader")
matches(workspace, /Missing finals/, "workspace exposes omitted photos")
matches(workspace, /Approve in Proofing/, "workspace routes missing finals to the exact proofing item")
matches(workspace, /I reviewed these warnings/, "workspace requires explicit warning acknowledgement")
matches(deliveryPage, /No latest-version fallback is used/, "delivery route states the selection boundary")
matches(activity, /Prepare approved delivery/, "Activity links approved work to delivery")

console.log(`delivery: ${assertions} assertions passed`)
