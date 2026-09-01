import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  automaticVersionLabel,
  branchContext,
  formatGenerationCost,
  normalizeVersionLabel,
  validateVariationInput,
  variationGenerationCostCents,
} from "../lib/versioning.ts"

let assertions = 0
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message)
  assertions += 1
}
function matches(actual, expected, message) {
  assert.match(actual, expected, message)
  assertions += 1
}
function throws(fn, expected, message) {
  assert.throws(fn, expected, message)
  assertions += 1
}

equal(normalizeVersionLabel("  Warm   oak  "), "Warm oak", "normalizes a meaningful version name")
equal(normalizeVersionLabel("   ", true), null, "an empty rename restores the automatic name")
throws(() => normalizeVersionLabel(" "), /Give this version a name/, "a required name cannot be empty")
throws(() => normalizeVersionLabel("x".repeat(81)), /at most 80/, "names have a bounded length")

const validRequest = validateVariationInput({
  requestId: "30000000-0000-4000-8000-000000000052",
  count: 3,
  instructions: " Try three warmer arrangements ",
  labels: ["Warm linen", "Light oak", "Soft contrast"],
})
equal(validRequest.count, 3, "accepts a bounded variation count")
equal(validRequest.instructions, "Try three warmer arrangements", "normalizes shared direction")
equal(validRequest.labels[1], "Light oak", "preserves explicit sibling names")
throws(() => validateVariationInput({ ...validRequest, count: 5, labels: [...validRequest.labels, "D", "E"] }), /Choose 2–4/, "rejects unbounded variations")
throws(() => validateVariationInput({ ...validRequest, labels: ["Same", "same", "Third"] }), /different name/, "rejects ambiguous duplicate names")
throws(() => validateVariationInput({ ...validRequest, requestId: "retry-me" }), /valid retry identity/, "requires idempotent UUID identity")
equal(variationGenerationCostCents(2.1, 4), 8.4, "quotes the exact configured initial generation cost")
equal(formatGenerationCost(8.4), "$0.08", "formats generation cost without exposing a provider")
equal(automaticVersionLabel({ versionLabel: "Client favorite", parentVersionId: "old", versionNumber: 2 }), "Client favorite", "custom name wins")
equal(automaticVersionLabel({ parentVersionId: null, versionNumber: 1 }), "Original edit", "root output has a useful fallback")
equal(automaticVersionLabel({ parentVersionId: "old", versionNumber: 2 }), "Revision 1", "branch output has a useful fallback")
equal(automaticVersionLabel({ parentVersionId: "old", versionNumber: 1, variationIndex: 2 }), "Variation 2", "cross-group sibling has a useful fallback")
equal(branchContext({ parentVersionId: "old" }, [{ id: "old", displayLabel: "Warm oak" }]), "Branched from Warm oak", "branch context resolves its named parent")
equal(branchContext({ parentVersionId: "missing" }, []), "Branched from an earlier saved version", "missing parent preview fails honestly")

const migration = readFileSync("supabase/migrations/0017_version_labels.sql", "utf8")
const labelRoute = readFileSync("app/api/output-versions/[versionId]/route.ts", "utf8")
const variationRoute = readFileSync("app/api/output-versions/[versionId]/variations/route.ts", "utf8")
const orchestrator = readFileSync("lib/orchestrator.ts", "utf8")
const page = readFileSync("app/listings/[id]/f/[fileGroupId]/page.tsx", "utf8")
const workspace = readFileSync("app/listings/[id]/f/[fileGroupId]/file-group-workspace.tsx", "utf8")
const proofing = readFileSync("app/listings/[id]/proofing/proofing-workspace.tsx", "utf8")
const compare = readFileSync("components/before-after.tsx", "utf8")

for (const invariant of [
  "version_label", "variation_requests", "requested_output_label", "variation_index",
  "validate_output_version_parent_lineage", "read own variation requests", "create_variation_request",
]) matches(migration, new RegExp(invariant), `migration contains ${invariant}`)
matches(migration, /kind in \('normal', 'ideas', 'variation'\)/, "variation work has an explicit job kind")
matches(migration, /grant execute on function create_variation_request[\s\S]*to service_role/, "variation creation is server-only")
matches(migration, /parent version must belong to the same listing photo/, "database rejects cross-photo branch lineage")
matches(migration, /target_request_id[\s\S]*p_request_id/, "variation scope reuses the durable request identity")
matches(migration, /pg_advisory_xact_lock/, "simultaneous exact retries serialize before receipt lookup")
matches(migration, /variation_request_id, variation_index/, "sibling identity is durable and ordered")
matches(labelRoute, /select\("id"\)[\s\S]*createAdminClient/, "rename proves RLS ownership before server mutation")
matches(variationRoute, /select\("id, file_groups!inner/, "variation route proves source ownership with an RLS read")
matches(variationRoute, /validateVariationInput/, "variation route strictly validates count, direction, labels, and retry ID")
matches(variationRoute, /for \(const fileGroupId of fileGroupIds\) await submitStep/, "every sibling has an independent state machine")
matches(orchestrator, /version_label: fg\.requested_output_label/, "completed siblings retain their requested names")
matches(orchestrator, /isVariationJob \|\| skipsQA/, "variation count is not silently expanded by auto-QA")
matches(page, /eq\("primary_photo_id", currentRaw\.primary_photo_id\)/, "workspace loads every lineage-compatible version for one photo")
matches(workspace, /Compare any two/, "workspace offers deliberate two-version comparison")
matches(workspace, /Naming does not change the approved final/, "rename states its approval boundary")
matches(workspace, /Variations do not move the approved final/, "variation confirmation states its approval boundary")
matches(workspace, /One failed option will not remove successful siblings/, "partial failure behavior is explicit")
matches(workspace, /currentOwnsStatus = currentActive \|\| currentFailed/, "a failed sibling owns truthful status even when a successful image is available")
matches(workspace, /requested generations/, "generation count and initial cost are shown before submission")
matches(proofing, /versionLabel: version\.versionLabel/, "proofing uses durable custom names")
matches(compare, /beforeLabel = "Before"[\s\S]*afterLabel = "After"/, "existing comparison primitive supports named version pairs")
equal(/photo_finals[\s\S]*update|update[\s\S]*photo_finals/.test(variationRoute), false, "variation route cannot move an approved final")

console.log(`versioning: ${assertions} assertions passed`)
