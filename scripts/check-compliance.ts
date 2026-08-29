// Phase 21 self-check: complianceVisionChecks branches + prompt variant shape.
// Run: npx tsx scripts/check-compliance.ts
import assert from "node:assert"
import { complianceVisionChecks, COMPLIANCE_QA_SYSTEM, QA_SYSTEM } from "../lib/prompts"

const ids = (chain: { edit_type: string; options?: Record<string, unknown> }[]) =>
  complianceVisionChecks(chain).map((c) => c.id)

assert.deepEqual(ids([{ edit_type: "IMAGE_ENHANCEMENT" }]), [])
assert.deepEqual(ids([{ edit_type: "VIRTUAL_STAGING" }]), ["no_fabricated_features"])
assert.deepEqual(ids([{ edit_type: "VIRTUAL_RENOVATION" }, { edit_type: "REWORK" }]), [
  "no_fabricated_features",
])
assert.deepEqual(ids([{ edit_type: "DAY_TO_DUSK" }]), [
  "dusk_no_new_window_glow",
  "dusk_sky_shadow_consistent",
]) // preset defaults to dusk
assert.deepEqual(ids([{ edit_type: "DAY_TO_DUSK", options: { preset: "golden_hour" } }]), [])
assert.deepEqual(
  ids([{ edit_type: "IMAGE_ENHANCEMENT" }, { edit_type: "VIRTUAL_STAGING" }, { edit_type: "DAY_TO_DUSK", options: { preset: "dusk" } }]),
  ["no_fabricated_features", "dusk_no_new_window_glow", "dusk_sky_shadow_consistent"]
)

assert.ok(COMPLIANCE_QA_SYSTEM.startsWith(QA_SYSTEM))
assert.ok(COMPLIANCE_QA_SYSTEM.includes('"checks":[{"id":"<id>"'))

console.log("compliance self-check: all assertions pass")
