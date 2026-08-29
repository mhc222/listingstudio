// Phase 23 self-check: MARKUP_EDIT template shape. npx tsx scripts/check-markup.ts
import assert from "node:assert"
import { compilePrompt, GEOMETRY_INTERIOR, LISTING_SUFFIX } from "../lib/prompts"

const step = (o: Record<string, unknown>) => ({ edit_type: "MARKUP_EDIT", options: o })

// remove-only, no comment
const rm = compilePrompt(step({ markup_path: "u/markup/x.jpg", remove_count: 2 }))
assert(rm.split(" ").slice(0, 10).join(" ").includes("Bright"), "brightness cue in first 10 words")
assert(rm.includes(GEOMETRY_INTERIOR), "geometry verbatim")
assert(rm.trimEnd().endsWith(LISTING_SUFFIX), "listing suffix last")
assert(rm.includes("Each blue circle (2 total)"), "remove clause with count")
assert(!rm.includes("red rectangle marks"), "no replace clause when replace_count=0")
assert(rm.includes("Do not render the blue circles, red rectangles"), "no-render clause")

// replace-only with comment
const rp = compilePrompt(
  step({ markup_path: "u/markup/x.jpg", replace_count: 1 }),
  "swap it for a leather recliner"
)
assert(rp.includes("Each red rectangle (1 total)"), "replace clause with count")
assert(rp.includes("client notes"), "replace clause points at the comment")
assert(rp.includes("swap it for a leather recliner"), "comment appended")
assert(!rp.includes("Each blue circle"), "no remove clause when remove_count=0")

// replace-only WITHOUT comment falls back to style-matched replacement
const rpNo = compilePrompt(step({ markup_path: "u/markup/x.jpg", replace_count: 1 }))
assert(rpNo.includes("similar item in better condition"), "comment-less replace fallback")

// both + grounding
const both = compilePrompt(
  step({ markup_path: "u/markup/x.jpg", remove_count: 1, replace_count: 1 }),
  "red = new sofa",
  { dimensions: "The room measures 14 x 16 feet; scale all furniture and objects to these dimensions." }
)
assert(both.includes("Each blue circle") && both.includes("Each red rectangle"), "both clauses")
assert(both.includes("14 x 16 feet"), "grounding injected")
assert(
  both.indexOf(GEOMETRY_INTERIOR) < both.indexOf("14 x 16 feet"),
  "grounding after geometry, matching the other templates"
)

console.log("check-markup: all assertions pass")
