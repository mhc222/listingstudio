import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  buildScopedReworkSnapshot,
  protectedGeometryForChain,
  scopedReworkCostCents,
  validateScopedReworkInput,
} from "../lib/scoped-rework.ts"

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

const ids = {
  request: "53000000-0000-4000-8000-000000000001",
  room: "53000000-0000-4000-8000-000000000002",
  photo1: "53000000-0000-4000-8000-000000000003",
  photo2: "53000000-0000-4000-8000-000000000004",
  version1: "53000000-0000-4000-8000-000000000005",
  version2: "53000000-0000-4000-8000-000000000006",
  group1: "53000000-0000-4000-8000-000000000007",
  group2: "53000000-0000-4000-8000-000000000008",
}

const input = validateScopedReworkInput({
  requestId: ids.request,
  selectionMethod: "room",
  scopeId: ids.room,
  instructions: "  Make the sky slightly brighter  ",
  targets: [
    { sourcePhotoId: ids.photo1, sourceOutputVersionId: ids.version1, exception: null },
    { sourcePhotoId: ids.photo2, sourceOutputVersionId: ids.version2, exception: " Keep the porch light warm " },
  ],
})
equal(input.instructions, "Make the sky slightly brighter", "normalizes the shared correction")
equal(input.targets[1].exception, "Keep the porch light warm", "normalizes a per-target exception")
throws(() => validateScopedReworkInput({ ...input, targets: [] }), /Choose 2–100/, "no selection can never mean all")
throws(() => validateScopedReworkInput({ ...input, selectionMethod: "explicit", scopeId: ids.room }), /cannot claim/, "explicit scope cannot impersonate a room")
throws(() => validateScopedReworkInput({ ...input, scopeId: null }), /scope is missing/, "group scope requires its durable ID")
throws(() => validateScopedReworkInput({ ...input, requestId: "retry" }), /Retry identity is invalid/, "requires UUID retry identity")
throws(() => validateScopedReworkInput({ ...input, targets: [input.targets[0], input.targets[0]] }), /one exact result per photo/, "rejects duplicate photos")

equal(protectedGeometryForChain([{ edit_type: "IMAGE_ENHANCEMENT" }]), "interior", "normal edits retain room geometry")
equal(protectedGeometryForChain([{ edit_type: "DAY_TO_DUSK" }]), "exterior", "dusk work protects the house exterior")
equal(scopedReworkCostCents([
  { providerCostCents: 2.1 }, { providerCostCents: 3.9 },
]), 6, "mixed source providers produce an exact initial quote")

const sources = [
  {
    sourcePhotoId: ids.photo1,
    sourceOutputVersionId: ids.version1,
    sourceFileGroupId: ids.group1,
    roomId: ids.room,
    sameRoomGroupId: null,
    editChain: [{ edit_type: "DAY_TO_DUSK" }],
    providerCostCents: 2.1,
  },
  {
    sourcePhotoId: ids.photo2,
    sourceOutputVersionId: ids.version2,
    sourceFileGroupId: ids.group2,
    roomId: ids.room,
    sameRoomGroupId: null,
    editChain: [{ edit_type: "DAY_TO_DUSK" }],
    providerCostCents: 3.9,
  },
]
const snapshot = buildScopedReworkSnapshot(input, sources)
equal(snapshot.targetCount, 2, "snapshot counts the exact targets")
equal(snapshot.requestedGenerationCount, 2, "initial generation count is one per target")
equal(snapshot.initialGenerationCostCents, 6, "snapshot stores the exact initial generation cost")
equal(snapshot.targets[1].sourceOutputVersionId, ids.version2, "snapshot preserves ordered exact source lineage")
equal(snapshot.targets[1].exception, "Keep the porch light warm", "snapshot persists the target exception")
equal(snapshot.targets[0].protectedGeometry, "exterior", "snapshot persists the source-chain geometry guard")
throws(
  () => buildScopedReworkSnapshot({ ...input, scopeId: ids.photo1 }, sources),
  /displayed room/,
  "room-scoped request cannot escape its displayed room"
)

const migration = readFileSync("supabase/migrations/0018_scoped_rework.sql", "utf8")
const prompts = readFileSync("lib/prompts.ts", "utf8")
for (const invariant of [
  "scoped_rework_requests", "scoped_rework_targets", "create_scoped_rework_request",
  "requested_targets", "target_snapshot", "protected_geometry", "generation_cost_cents",
]) matches(migration, new RegExp(invariant), `migration contains ${invariant}`)
matches(migration, /pg_advisory_xact_lock/, "simultaneous duplicate submissions serialize")
matches(migration, /source version not found for selected photo/, "database revalidates exact photo/version lineage")
matches(migration, /target escaped the selected room scope/, "database rejects room-scope drift")
matches(migration, /target escaped the selected same-room group scope/, "database rejects same-room scope drift")
matches(migration, /is_current_logical_photo/, "database rejects superseded logical targets")
matches(migration, /jsonb_array_length\(v_chain\) - 1/, "every child begins only at its appended rework step")
matches(migration, /unique \(request_id, source_photo_id\)/, "one request cannot target a photo twice")
matches(migration, /to service_role/, "scoped request creation is server-only")
matches(prompts, /protected_geometry === "exterior" \? GEOMETRY_EXTERIOR : GEOMETRY_INTERIOR/, "compiler retains the correct verbatim geometry constraint")

console.log(`scoped rework: ${assertions} assertions passed`)

