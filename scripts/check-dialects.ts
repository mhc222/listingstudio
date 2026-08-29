// Phase 24 self-check: provider-aware prompt compilation.
// Run: npx tsx scripts/check-dialects.ts
import {
  compilePrompt,
  GEOMETRY_INTERIOR,
  GEOMETRY_EXTERIOR,
  LISTING_SUFFIX,
  GEMINI_PRESERVE,
  KONTEXT_MAINTAIN,
  EQUIRECT_360,
} from "../lib/prompts"
import { validateIntent } from "../lib/interpreter"

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const staging = {
  edit_type: "VIRTUAL_STAGING",
  options: { room_type: "living_room", furniture_style: "farmhouse" },
}
const grounding = { dimensions: "The room measures 14 x 16 feet; scale all furniture and objects to these dimensions." }

const qwen = compilePrompt(staging, "make it feel warm", grounding, "qwen")
const gemini = compilePrompt(staging, "make it feel warm", grounding, "gemini")
const kontext = compilePrompt(staging, "make it feel warm", grounding, "kontext")

// three distinct provider-shaped prompts from the same spec (DoD)
assert(qwen !== gemini && gemini !== kontext && qwen !== kontext, "dialects must differ")

// geometry sentence verbatim in all three (DoD)
for (const [name, p] of [["qwen", qwen], ["gemini", gemini], ["kontext", kontext]] as const) {
  assert(p.includes(GEOMETRY_INTERIOR), `${name}: geometry verbatim`)
  assert(p.includes(grounding.dimensions), `${name}: grounding injected`)
  assert(p.endsWith(LISTING_SUFFIX), `${name}: suffix stays last (rule 4)`)
}

// qwen = the base dialect, no gemini/kontext shaping
assert(!qwen.includes(GEMINI_PRESERVE) && !qwen.includes(KONTEXT_MAINTAIN), "qwen is the base dialect")
assert(compilePrompt(staging, "make it feel warm", grounding) === qwen, "provider defaults to qwen")
assert(compilePrompt(staging, "make it feel warm", grounding, "local") === qwen, "local stub uses the base dialect")

// gemini: Google's template shape — instruction framing + preservation close
assert(gemini.startsWith("Edit the provided photo: "), "gemini: instruction framing prefix")
assert(gemini.includes(GEMINI_PRESERVE), "gemini: preservation clause present")
assert(
  gemini.split(/\s+/).slice(0, 10).join(" ").toLowerCase().includes("bright"),
  "gemini: brightness cue within first ten words (rule 2)"
)

// kontext: BFL "while maintaining ..." clause, direct naming untouched
assert(kontext.includes(KONTEXT_MAINTAIN), "kontext: maintain clause present")
assert(!kontext.startsWith("Edit the provided photo:"), "kontext: no gemini prefix")

// exterior edit keeps the exterior geometry sentence verbatim in a dialect
const landK = compilePrompt({ edit_type: "VIRTUAL_LANDSCAPING", options: {} }, null, undefined, "kontext")
assert(landK.includes(GEOMETRY_EXTERIOR) && landK.includes(KONTEXT_MAINTAIN), "kontext landscaping: exterior geometry + clause")

// FLOOR_PLAN_REDRAW is exempt — a redraw transforms everything
const planStep = { edit_type: "FLOOR_PLAN_REDRAW", options: { style: "2d_colour" } }
const planQ = compilePrompt(planStep, null, undefined, "qwen")
const planG = compilePrompt(planStep, null, undefined, "gemini")
assert(planQ === planG && !planG.includes(GEMINI_PRESERVE), "plan redraw: dialect-exempt")

// templates without the listing suffix (portrait) append the clause at the end
const portraitG = compilePrompt({ edit_type: "PORTRAIT_RETOUCHING" }, null, undefined, "gemini")
assert(portraitG.endsWith(GEMINI_PRESERVE), "portrait gemini: clause appended, no suffix")

// 360 chains (qwen-forced) keep the equirect block, base dialect
const pano = compilePrompt({ edit_type: "360_IMAGE_ENHANCEMENT" }, null, undefined, "qwen")
assert(pano.endsWith(EQUIRECT_360), "360: equirect block last, unchanged")

// interpreter round-trips comment_imperative (DoD)
const intent = validateIntent({
  kind: "job",
  edit_chain: [{ edit_type: "IMAGE_ENHANCEMENT", options: {} }],
  comment: "cozy vibes",
  comment_imperative: "make the room feel cozy and warm",
  defaults_noted: [],
})
assert(
  intent.kind === "job" && intent.comment_imperative === "make the room feel cozy and warm",
  "comment_imperative round-trips"
)
assert(intent.kind === "job" && intent.comment === "cozy vibes", "verbatim comment preserved")
const noImp = validateIntent({
  kind: "job",
  edit_chain: [{ edit_type: "SHADOW_REMOVAL", options: {} }],
  comment: "fix it",
})
assert(noImp.kind === "job" && noImp.comment_imperative === "", "missing comment_imperative defaults to empty")

console.log("check-dialects: all assertions passed")
console.log("\n--- staging on qwen ---\n" + qwen)
console.log("\n--- staging on gemini ---\n" + gemini)
console.log("\n--- staging on kontext ---\n" + kontext)
