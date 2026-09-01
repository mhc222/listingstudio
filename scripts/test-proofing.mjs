import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  ORIGINAL_SELECTION,
  deriveProofingQaStatus,
  deriveProofingStatus,
  initialProofingSelection,
  proofingFinalKey,
  proofingApprovalCounts,
  reconcileProofingSelection,
} from "../lib/proofing.ts"

let assertions = 0
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message)
  assertions += 1
}
function matches(actual, expected, message) {
  assert.match(actual, expected, message)
  assertions += 1
}

const versions = [
  { id: "old", versionNumber: 1, createdAt: "2026-09-01T10:00:00Z", reviewState: "unreviewed", qaNeedsReview: false },
  { id: "new", versionNumber: 2, createdAt: "2026-09-01T11:00:00Z", reviewState: "needs_changes", qaNeedsReview: true },
]

equal(initialProofingSelection({ finalExists: false, finalOutputVersionId: null, versions, groupStatuses: [] }), "new", "latest version is the initial unapproved review target")
equal(initialProofingSelection({ finalExists: true, finalOutputVersionId: "old", versions, groupStatuses: [] }), "old", "an older explicit final remains selected")
equal(initialProofingSelection({ finalExists: true, finalOutputVersionId: null, versions, groupStatuses: [] }), ORIGINAL_SELECTION, "an approved untouched original remains selected")
equal(deriveProofingStatus({ finalExists: false, finalOutputVersionId: null, versions, groupStatuses: [] }), "needs_changes", "needs-changes state follows the reviewed version")
equal(deriveProofingStatus({ finalExists: true, finalOutputVersionId: "old", versions, groupStatuses: ["running"] }), "approved", "new processing never moves an approved final")
equal(deriveProofingStatus({ finalExists: false, finalOutputVersionId: null, versions: [], groupStatuses: ["running"] }), "processing", "an output-less active source is processing")
equal(deriveProofingStatus({ finalExists: false, finalOutputVersionId: null, versions: [], groupStatuses: ["failed"] }), "needs_attention", "an output-less failed source needs attention")
equal(deriveProofingStatus({ finalExists: false, finalOutputVersionId: null, versions: [], groupStatuses: [] }), "unreviewed", "an original-only source is reviewable")
equal(deriveProofingQaStatus({ finalExists: false, finalOutputVersionId: null, versions, groupStatuses: [] }, "new"), "review", "QA warning follows selected version")
equal(deriveProofingQaStatus({ finalExists: false, finalOutputVersionId: null, versions, groupStatuses: [] }, "old"), "ready", "QA state changes with version selection")
equal(deriveProofingQaStatus({ finalExists: false, finalOutputVersionId: null, versions, groupStatuses: [] }, ORIGINAL_SELECTION), "original", "untouched original has no generated QA verdict")
equal(proofingApprovalCounts([
  { finalExists: true, finalOutputVersionId: null, versions: [], groupStatuses: [] },
  { finalExists: false, finalOutputVersionId: null, versions, groupStatuses: [] },
]), { approved: 1, total: 2, remaining: 1 }, "approval count uses logical sources, not outputs")
const approvedInput = { finalExists: true, finalOutputVersionId: "old", versions, groupStatuses: ["running"] }
equal(proofingFinalKey(approvedInput), "old", "final key identifies the exact durable version")
equal(reconcileProofingSelection("new", approvedInput, "old"), "new", "unchanged realtime refresh preserves a deliberate alternate-version selection")
equal(reconcileProofingSelection("new", { ...approvedInput, finalOutputVersionId: "new" }, "old"), "new", "a newly replaced final selects the new durable target")
equal(reconcileProofingSelection("new", { ...approvedInput, finalExists: false, finalOutputVersionId: null }, "old"), "new", "clearing a matching final preserves the needs-changes target")

const migration = readFileSync(new URL("../supabase/migrations/0015_proofing_and_finals.sql", import.meta.url), "utf8")
for (const invariant of [
  "review_state",
  "photo_finals",
  "proofing_requests",
  "set_photo_review",
  "is_current_logical_photo",
  "output version does not belong to this logical source",
  "on conflict (listing_id, source_photo_id)",
  "output_versions_guard_review",
  "read own photo finals",
]) matches(migration, new RegExp(invariant.replace(/[()]/g, "\\$&"), "i"), `migration contains ${invariant}`)

const server = readFileSync(new URL("../lib/proofing-server.ts", import.meta.url), "utf8")
const workspace = readFileSync(new URL("../app/listings/[id]/proofing/proofing-workspace.tsx", import.meta.url), "utf8")
const page = readFileSync(new URL("../app/listings/[id]/proofing/page.tsx", import.meta.url), "utf8")
const route = readFileSync(new URL("../app/api/listings/[id]/proofing/route.ts", import.meta.url), "utf8")
const oldZip = readFileSync(new URL("../app/api/listings/[id]/download-all/route.ts", import.meta.url), "utf8")
const activity = readFileSync(new URL("../app/listings/[id]/activity/page.tsx", import.meta.url), "utf8")
const individualDownload = readFileSync(new URL("../app/api/file-groups/[id]/download/route.ts", import.meta.url), "utf8")
for (const invariant of [
  "logicalPhotoIds",
  "photo_finals",
  "review_state",
]) matches(server, new RegExp(invariant), `proofing loader contains ${invariant}`)
for (const invariant of [
  "Proofing contact sheet",
  "ArrowLeft",
  "ArrowRight",
  "Approve final",
  "Needs changes",
  "All review states",
  "All QA states",
]) matches(workspace, new RegExp(invariant), `proofing workspace contains ${invariant}`)
matches(page, /Opening a photo never approves it/, "proofing page makes passive viewing semantics explicit")
matches(route, /set_photo_review/, "authenticated route uses the validated atomic review RPC")
matches(activity, /final\.output_version_id !== null[\s\S]*group\.output_versions\.some/, "activity marks only the file group containing the exact approved output")
matches(server, /createAdminClient[\s\S]*storageClient/, "owned proofing rows support legacy output storage paths")
matches(individualDownload, /download\("outputs", version\.storage_path, storageClient\)/, "individual downloads retain legacy output compatibility after ownership proof")
matches(oldZip, /loadDeliveryPackageContext/, "Phase 51 archive recomputes the explicit approved set")
equal(/JSZip|generateAsync|output_versions/.test(oldZip), false, "approved archive cannot collect latest output versions or whole-package buffer")

console.log(`proofing: ${assertions} assertions passed`)
