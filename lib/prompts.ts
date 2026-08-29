// All prompt templates live here, named exports per edit type.
// User comments append to templates, never replace them.

// Verbatim geometry constraints — never paraphrase (CLAUDE.md).
export const GEOMETRY_INTERIOR =
  "Do not alter room dimensions, wall positions, window or door placement, flooring, ceiling height, or camera perspective. Furniture must be realistically scaled to the room."
export const GEOMETRY_EXTERIOR =
  "Do not alter the house structure, rooflines, window or door placement, driveway footprint, lot boundaries, or camera perspective."

export const LISTING_SUFFIX =
  "wide-angle real estate listing photography, inviting and spacious."

export type EditStep = {
  edit_type: string
  options?: Record<string, unknown>
}

// Context grounding injected by the compiler (CLAUDE.md): room dimensions as a
// sentence for staging/renovation/item-removal prompts.
export type Grounding = {
  dimensions?: string | null
}

export function ITEM_REMOVAL(
  options: { tier?: 1 | 2; items?: string } = {},
  comment?: string | null,
  grounding?: Grounding
): string {
  const tier = options.tier === 2 ? 2 : 1
  const items = (options.items ?? "").trim()
  const parts = [
    // brightness cue inside the first ten words
    "Bright natural daylight real estate photo of this exact room.",
    items
      ? `Remove the following items completely: ${items}.`
      : "Remove clutter from the room.",
    tier === 2
      ? "Fully declutter the space: also remove all loose clutter, personal items, cords, papers, and small objects from floors, counters, and surfaces, leaving furniture and fixed decor in place."
      : "Remove only these specific items; leave all other furniture and decor exactly as it is.",
    "Realistically reconstruct the floors, walls, and surfaces revealed behind removed items, matching the existing materials, lighting, and shadows.",
    "Keep every fixed fixture and architectural feature pixel-identical to the original: fireplace and its flames, built-in shelving and cabinetry, light fixtures, windows, and trim.",
    GEOMETRY_INTERIOR,
  ]
  if (grounding?.dimensions) parts.push(grounding.dimensions)
  if (comment?.trim()) parts.push(comment.trim())
  parts.push(LISTING_SUFFIX)
  return parts.join(" ")
}

const SKY_STYLES: Record<string, string> = {
  any: "an attractive natural daytime sky",
  clear_blue: "a clear blue daytime sky",
  clouds_blue: "a blue daytime sky with scattered white clouds",
  orange_sunrise: "a warm orange sunrise sky",
}

export type ImageEnhancementOptions = {
  sky_replacement?: boolean
  day_sky_style?: string
  grass_repair?: boolean
}

export function IMAGE_ENHANCEMENT(
  options: ImageEnhancementOptions = {},
  comment?: string | null
): string {
  const parts = [
    // brightness cue inside the first ten words
    "Bright natural daylight enhancement of this exact real estate photo.",
    "Correct white balance and color tone, sharpen details, straighten verticals, and correct lens distortion.",
    "Remove dust spots, blemishes, camera flash hotspots, and any photographer reflections in mirrors or windows.",
    "Balance window exposure so the view outside stays visible without darkening the interior.",
    "If a TV screen is visible, replace its contents with a neutral scenic image. If a fireplace is present, show a warm lit fire in it.",
  ]
  if (options.sky_replacement) {
    parts.push(
      `Replace the sky with ${SKY_STYLES[options.day_sky_style ?? "any"] ?? SKY_STYLES.any}, keeping lighting on the scene consistent with it.`
    )
  }
  if (options.grass_repair) {
    parts.push(
      "Repair the lawn: make all grass evenly green, healthy, and neatly maintained, filling in bare and brown patches."
    )
  }
  parts.push(GEOMETRY_INTERIOR)
  if (comment?.trim()) parts.push(comment.trim())
  parts.push(LISTING_SUFFIX)
  return parts.join(" ")
}

// no options — standalone or stacked
export function TURN_ON_LIGHTS(comment?: string | null): string {
  const parts = [
    // brightness cue inside the first ten words
    "Bright, warmly lit real estate photo of this exact room.",
    "Turn on every light fixture: ceiling lights, chandeliers, pendant lights, lamps, and sconces all emit a warm inviting glow.",
    "Render realistic warm illumination and soft light falloff from each fixture onto nearby surfaces, leaving everything else in the scene unchanged.",
    GEOMETRY_INTERIOR,
  ]
  if (comment?.trim()) parts.push(comment.trim())
  parts.push(LISTING_SUFFIX)
  return parts.join(" ")
}

// One aesthetic per style, specific materials (prompt engineering rule 3).
export const FURNITURE_STYLES: Record<string, { label: string; desc: string }> = {
  modern: {
    label: "Modern",
    desc: "modern style: clean-lined furniture, charcoal and white upholstery, matte black metal accents, light oak wood",
  },
  contemporary: {
    label: "Contemporary",
    desc: "contemporary style: soft neutral upholstery in warm greige, walnut wood, brushed nickel accents",
  },
  farmhouse: {
    label: "Farmhouse",
    desc: "modern farmhouse style: natural linen upholstery, reclaimed pine wood, a woven jute rug, soft white and sage accents",
  },
  traditional: {
    label: "Traditional",
    desc: "traditional style: rolled-arm seating in cream fabric, dark cherry wood, brass accents",
  },
  urban_industrial: {
    label: "Urban/Industrial",
    desc: "urban industrial style: cognac brown leather seating, raw steel frames, reclaimed wood surfaces",
  },
  mid_century_modern: {
    label: "Mid-Century Modern",
    desc: "mid-century modern style: teak wood furniture with tapered legs, mustard and teal accents, a geometric-pattern rug",
  },
  hamptons: {
    label: "Hamptons",
    desc: "Hamptons coastal style: light linen upholstery in a white and navy palette, natural rattan accents, whitewashed oak",
  },
  commercial: {
    label: "Commercial",
    desc: "commercial style: office-grade desks and seating in gray and white laminate, minimal decor",
  },
  scandinavian: {
    label: "Scandinavian",
    desc: "Scandinavian style: light birch wood furniture, white and pale gray textiles, simple clean lines, wool throw accents",
  },
}

const ROOM_LABELS: Record<string, string> = {
  living_room: "living room",
  kitchen: "kitchen",
  dining: "dining room",
  main_bedroom: "main bedroom",
  bedroom_2: "bedroom",
  bedroom_3: "bedroom",
  bedroom_4: "bedroom",
  bathroom_ensuite: "bathroom",
  office: "home office",
  outdoor_patio: "outdoor patio",
  other: "room",
}

const ROOM_FURNITURE: Record<string, string> = {
  living_room:
    "a sofa, accent chairs, a coffee table, an area rug, side tables with lamps, and tasteful wall art",
  kitchen: "bar stools at any counter or island and minimal styled counter decor",
  dining: "a dining table with chairs, a simple centerpiece, and an area rug",
  main_bedroom:
    "a made bed with headboard and layered bedding, nightstands with lamps, a bench at the foot of the bed, and an area rug",
  bedroom_2: "a made bed with headboard, nightstands with lamps, and an area rug",
  bedroom_3: "a made bed with headboard, nightstands with lamps, and an area rug",
  bedroom_4: "a made bed with headboard, nightstands with lamps, and an area rug",
  bathroom_ensuite: "neatly folded towels, a bath mat, and minimal counter styling",
  office: "a desk with a chair, a bookshelf, and an area rug",
  outdoor_patio: "an outdoor seating set, an outdoor rug, and potted plants",
  other: "furniture and decor appropriate to the room's function",
}

export type VirtualStagingOptions = {
  room_type?: string
  furniture_style?: string
  furniture_required?: string
}

export function VIRTUAL_STAGING(
  options: VirtualStagingOptions = {},
  comment?: string | null,
  grounding?: Grounding
): string {
  const roomType = options.room_type ?? "other"
  const style = FURNITURE_STYLES[options.furniture_style ?? "modern"] ?? FURNITURE_STYLES.modern
  const required = (options.furniture_required ?? "").trim()
  const parts = [
    // brightness cue inside the first ten words
    `Bright natural daylight photo of this exact ${ROOM_LABELS[roomType] ?? "room"}, virtually staged.`,
    `Furnish it in ${style.desc}.`,
    `Add ${ROOM_FURNITURE[roomType] ?? ROOM_FURNITURE.other}.`,
    // spatial anchoring (prompt engineering rule 1): light entry, furniture vs walls/windows, surfaces
    "Anchor every piece to the room as photographed: orient seating toward the room's natural focal point, place large furniture against walls, leave every window, doorway, and walkway unobstructed, and light the furniture consistently with the natural light entering through the existing windows.",
    "Keep the existing flooring, wall finishes, and ceiling exactly as they appear in the photo.",
  ]
  if (grounding?.dimensions) parts.push(grounding.dimensions)
  if (required) parts.push(`Required furniture: ${required}.`)
  parts.push(
    "If reference images are provided, match their furniture style, materials, and color palette."
  )
  parts.push(GEOMETRY_INTERIOR)
  if (comment?.trim()) parts.push(comment.trim())
  parts.push(LISTING_SUFFIX)
  return parts.join(" ")
}

// Tiers change prompt aggressiveness only (CLAUDE.md).
const RENOVATION_TIERS: Record<string, string> = {
  light:
    "Make only the minimal changes described, keeping every other finish, fixture, and surface exactly as photographed.",
  mid: "Update the described finishes plus directly adjacent trim and hardware so the result reads cohesive; leave everything else as photographed.",
  full: "Comprehensively renovate the visible finishes into one cohesive result built around the described changes.",
}

export type VirtualRenovationOptions = {
  tier?: string
  changes?: string
}

export function VIRTUAL_RENOVATION(
  options: VirtualRenovationOptions = {},
  comment?: string | null,
  grounding?: Grounding
): string {
  const changes = (options.changes ?? "").trim()
  const parts = [
    // brightness cue inside the first ten words
    "Bright natural daylight photo of this exact room, virtually renovated.",
    changes
      ? `Apply these finish changes: ${changes}.`
      : "Tastefully update the visible finishes to a clean, current look.",
    RENOVATION_TIERS[options.tier ?? "mid"] ?? RENOVATION_TIERS.mid,
    // spatial anchoring: everything stays where it is, only finishes change
    "Keep all cabinetry, appliances, fixtures, and furniture in their existing positions, and keep the natural light entering through the existing windows unchanged.",
  ]
  if (grounding?.dimensions) parts.push(grounding.dimensions)
  parts.push(GEOMETRY_INTERIOR)
  if (comment?.trim()) parts.push(comment.trim())
  parts.push(LISTING_SUFFIX)
  return parts.join(" ")
}

export function VIRTUAL_LANDSCAPING(
  options: { instructions?: string } = {},
  comment?: string | null
): string {
  const instructions = (options.instructions ?? "").trim()
  const parts = [
    // brightness cue inside the first ten words
    "Bright natural daylight photo of this exact home exterior, professionally landscaped.",
    "Make the lawn evenly green and healthy, tidy the planting beds with fresh dark mulch and flowering shrubs, and keep walkways clean and edged.",
    // spatial anchoring: plantings follow the existing beds and paths
    "Place all new plantings along the existing bed lines and walkway edges, realistically scaled, without blocking windows, doors, or the view of the house.",
  ]
  if (instructions) parts.push(`Also: ${instructions}.`)
  parts.push(GEOMETRY_EXTERIOR)
  if (comment?.trim()) parts.push(comment.trim())
  parts.push(LISTING_SUFFIX)
  return parts.join(" ")
}

// dusk (exterior) is the headline preset; the interior siblings are
// relight-only variants (CLAUDE.md).
export const LIGHT_PRESETS: Record<string, { label: string; opening: string; body: string }> = {
  dusk: {
    label: "Dusk (exterior)",
    opening: "Warm glowing twilight photo of this exact home exterior at dusk.",
    body: "Replace the sky with a rich dusk gradient of deep blue fading to soft orange at the horizon, make every visible window glow with warm interior light, turn on exterior fixtures, and keep the remaining shadows consistent with the dusk sky's light direction.",
  },
  bright_daylight: {
    label: "Bright daylight (interior)",
    opening: "Bright natural daylight relighting of this exact room.",
    body: "Relight the scene as a bright, airy daytime interior with soft natural light from the existing windows. Change only the lighting; leave every object and surface exactly as photographed.",
  },
  golden_hour: {
    label: "Golden hour (interior)",
    opening: "Warm golden hour relighting of this exact room.",
    body: "Relight the scene with low warm golden-hour sunlight streaming through the existing windows, casting soft warm highlights. Change only the lighting; leave every object and surface exactly as photographed.",
  },
  soft_overcast: {
    label: "Soft overcast (interior)",
    opening: "Soft, evenly lit overcast relighting of this exact room.",
    body: "Relight the scene with diffuse, shadowless overcast daylight from the existing windows. Change only the lighting; leave every object and surface exactly as photographed.",
  },
}

export function DAY_TO_DUSK(
  options: { preset?: string } = {},
  comment?: string | null
): string {
  const preset = LIGHT_PRESETS[options.preset ?? "dusk"] ?? LIGHT_PRESETS.dusk
  const isDusk = (options.preset ?? "dusk") === "dusk"
  const parts = [preset.opening, preset.body, isDusk ? GEOMETRY_EXTERIOR : GEOMETRY_INTERIOR]
  if (comment?.trim()) parts.push(comment.trim())
  parts.push(LISTING_SUFFIX)
  return parts.join(" ")
}

// One named element, all else untouched (CLAUDE.md).
export function COLOUR_CHANGE(
  options: { element?: string; colour?: string } = {},
  comment?: string | null
): string {
  const element = (options.element ?? "").trim() || "the named element"
  const colour = (options.colour ?? "").trim() || "the requested colour"
  const parts = [
    // brightness cue inside the first ten words
    `Bright natural daylight photo of this exact scene, recoloring ${element}.`,
    `Change the colour of ${element} to ${colour}, keeping its material, texture, sheen, and lighting realistic.`,
    "Leave every other element of the image pixel-identical to the original.",
    GEOMETRY_INTERIOR,
  ]
  if (comment?.trim()) parts.push(comment.trim())
  parts.push(LISTING_SUFFIX)
  return parts.join(" ")
}

export function SHADOW_REMOVAL(comment?: string | null): string {
  const parts = [
    // brightness cue inside the first ten words
    "Bright, evenly lit real estate photo of this exact scene.",
    "Remove harsh cast shadows and hotspots, balancing the lighting evenly across all surfaces while preserving natural depth, textures, and soft ambient shading.",
    GEOMETRY_INTERIOR,
  ]
  if (comment?.trim()) parts.push(comment.trim())
  parts.push(LISTING_SUFFIX)
  return parts.join(" ")
}

// Floor plan redraw (phase 11). Input must be a plan/sketch, never a room
// photo (CLAUDE.md) — the jobs route enforces is_floor_plan input. The 3D
// variant re-renders a finished 2D plan (attach it, then redraw in 3D).
export const PLAN_STYLES: Record<string, { label: string; desc: string }> = {
  "2d_bw": {
    label: "2D Black & White",
    desc: "clean 2D black-and-white architectural floor plan: crisp black wall lines on a pure white background, door swing arcs, and window openings marked in the walls",
  },
  "2d_colour": {
    label: "2D Full Colour",
    desc: "professional 2D full-colour floor plan: soft flat colour fills per room, dark wall lines, door swing arcs, and window openings marked in the walls",
  },
  "2d_textured": {
    label: "2D Colour Textured",
    desc: "professional 2D colour floor plan with realistic material textures: wood-look flooring in living areas, tile in kitchens and bathrooms, carpet in bedrooms, dark wall lines, door swing arcs",
  },
  "3d": {
    label: "3D Isometric",
    desc: "3D isometric cutaway render of this single storey: walls extruded to partial height, realistic floor materials and finishes, viewed from an elevated 45-degree angle",
  },
}

// Standard export disclaimer (address label + disclaimer are composited in
// code at export/attach time — never prompted, AI-rendered fine print garbles).
export const PLAN_DISCLAIMER =
  "This floor plan is for illustrative purposes only. All measurements are approximate and should be independently verified."

export type FloorPlanRedrawOptions = {
  style?: string
  units?: string // "sqft" | "sqm"
  furniture?: boolean
  north_arrow?: boolean
  // export-time compositing flags, carried on the step but not prompted
  address_label?: boolean
  disclaimer?: string
}

export function FLOOR_PLAN_REDRAW(
  options: FloorPlanRedrawOptions = {},
  comment?: string | null,
  grounding?: Grounding
): string {
  const style = PLAN_STYLES[options.style ?? "2d_colour"] ?? PLAN_STYLES["2d_colour"]
  const units = options.units === "sqm" ? "square meters" : "square feet"
  const parts = [
    `Redraw the floor plan in this image as a ${style.desc}.`,
    "Reproduce the layout exactly as drawn: every wall, room, door, window, and opening stays in its drawn position and relative proportion. Never invent, remove, or move rooms or walls.",
    `Label every room with its name in clear, correctly spelled text, and show room dimensions in ${units} where the source plan provides measurements.`,
    options.furniture === false
      ? "Do not draw any furniture."
      : "Include simple to-scale furniture symbols appropriate to each room.",
  ]
  if (options.north_arrow) parts.push("Include a small north arrow.")
  if (grounding?.dimensions) parts.push(grounding.dimensions)
  if (comment?.trim()) parts.push(comment.trim())
  // no brightness cue or listing-photography suffix — this is a drawing, not a photo
  return parts.join(" ")
}

// Internal edit type (never user-pickable): a corrective pass over an existing
// output version. Used by conversational rework AND the auto-QA retry.
export type ReworkOptions = {
  instructions?: string
  // storage path (outputs bucket) of the version being branched from
  source_path?: string
  parent_version_id?: string
}

export function REWORK(options: ReworkOptions = {}): string {
  const instructions = (options.instructions ?? "").trim() || "improve the requested edit"
  const parts = [
    // brightness cue inside the first ten words
    "Bright natural real estate photo; apply only these corrections.",
    `Corrections: ${instructions}.`,
    "Change nothing else — every element not named above stays identical to the input image.",
    GEOMETRY_INTERIOR,
    LISTING_SUFFIX,
  ]
  return parts.join(" ")
}

// Rework interpreter (phase 8): reaction + conversation -> explicit corrective
// instructions. The instructions fill the REWORK template's slot.
export const REWORK_SYSTEM = `You turn a client's reaction to an AI-edited real estate photo into explicit corrective instructions for an image-editing model. You are given the conversation so far (what was requested and previously corrected) and the client's new reaction. Respond with a single JSON object and nothing else: {"instructions":"..."}

Rules:
- Imperative, concrete, self-contained: name the specific objects and the exact change ("change the sofa to gray", "remove the framed wall art above the sofa"). The image model sees only your instructions, never the conversation.
- Cover everything actionable in the new reaction; carry forward earlier corrections ONLY if the reaction says they are still wrong.
- Vague reactions get a sensible concrete reading ("too yellow" -> "correct the white balance to neutral, removing the yellow color cast").
- Never invent changes the client didn't imply.`

// Auto-QA vision pass (phase 8): result vs request + known failure modes.
export const QA_SYSTEM = `You are a strict QA reviewer for AI-edited real estate listing photos. You are shown the ORIGINAL photo first, then the EDITED result, plus the edit request. Judge whether the edit is acceptable to deliver. Respond with a single JSON object and nothing else: {"pass":true|false,"note":"one short sentence","corrective_instruction":null|"..."}

Check, in order:
1. The requested edits were actually applied.
2. No geometry drift: room dimensions, wall positions, window and door placement, flooring, ceiling height, and camera perspective must match the original.
3. No obvious AI artifacts: warped straight lines, impossible furniture, garbled text, duplicated objects, unrealistic scale.
Extra named checks may be appended to the request — apply them strictly.

- pass=true when the result is deliverable, even if imperfect; note the imperfection.
- pass=false only for defects a client would reject; corrective_instruction must then be a concrete imperative fix for the image model ("straighten the warped window frame on the left wall"). corrective_instruction is null when pass=true.`

// The two named dusk checks (CLAUDE.md rule 5), appended to the QA request
// when the chain contains a dusk conversion.
export const DUSK_QA_CHECKS =
  "Named checks for the dusk conversion: (a) no windows may glow in rooms that were dark in the original photo; (b) the dusk sky must be consistent with the direction of remaining shadows."

// Interpreter loop part 1 (CLAUDE.md): free text -> strict JSON job spec
// validated against the edit catalog. User language is preserved as comment
// and fills slots — it never replaces the hardened templates above.
export const INTERPRETER_SYSTEM = `You translate a real estate photographer's plain-English request into a structured photo-edit job for one photo. Respond with a single JSON object and nothing else — no prose, no markdown, no code fences.

Edit catalog (edit_type -> allowed options):
- IMAGE_ENHANCEMENT: { sky_replacement: boolean, day_sky_style: "any"|"clear_blue"|"clouds_blue"|"orange_sunrise", grass_repair: boolean } — general quality pass: white balance, sharpening, straightening, exposure, blemish removal. Use for "too dark", "dull", "make it pop", "fix the photo".
- TURN_ON_LIGHTS: {} — warm glow on ceiling lights, lamps, chandeliers.
- ITEM_REMOVAL: { tier: 1|2, items: string } — tier 1 removes only the named items; tier 2 is a full declutter. Put what to remove in items.
- VIRTUAL_STAGING: { room_type: "living_room"|"kitchen"|"dining"|"main_bedroom"|"bedroom_2"|"bedroom_3"|"bedroom_4"|"bathroom_ensuite"|"office"|"outdoor_patio"|"other", furniture_style: "modern"|"contemporary"|"farmhouse"|"traditional"|"urban_industrial"|"mid_century_modern"|"hamptons"|"commercial"|"scandinavian", furniture_required: string } — add furniture to an empty or sparse room. furniture_required carries any specific pieces the user asked for, else "".
- VIRTUAL_RENOVATION: { tier: "light"|"mid"|"full", changes: string } — change finishes (cabinets, counters, paint, floors). changes describes the requested finish changes.
- VIRTUAL_LANDSCAPING: { instructions: string } — exterior curb appeal: lawn, beds, plants, walkways, door color, porch furniture.
- DAY_TO_DUSK: { preset: "dusk"|"bright_daylight"|"golden_hour"|"soft_overcast" } — dusk is an exterior twilight conversion; the other three are interior relight-only presets.
- COLOUR_CHANGE: { element: string, colour: string } — recolor exactly one named element.
- SHADOW_REMOVAL: {} — remove harsh cast shadows.

Response shapes (exactly one):
1. {"kind":"job","edit_chain":[{"edit_type":"...","options":{...}}],"comment":"...","defaults_noted":["..."]}
2. {"kind":"question","question":"..."}
3. {"kind":"ideas","directions":[{"label":"...","edit_chain":[...]},{...},{...},{...}],"comment":"..."} — EXACTLY 4 directions

Rules:
- edit_chain is ordered; edits run in sequence, each edit's output feeding the next. Put IMAGE_ENHANCEMENT before VIRTUAL_STAGING, and ITEM_REMOVAL before either.
- Complaints about darkness, dullness, or photo quality mean IMAGE_ENHANCEMENT (with TURN_ON_LIGHTS only if the user asks for lights on).
- comment: preserve the user's own words (their request, lightly trimmed). Never invent detail they didn't give.
- Chips: the user may attach structured chip selections (edit type, room type, furniture style). Chips are authoritative — merge them into the spec even if the text doesn't mention them.
- Only ask a question (shape 2) when a required option is genuinely ambiguous AND guessing would likely waste a generation — e.g. staging requested but the room type is neither in the text, the chips, nor implied. Ask at most ONE question, then commit on the next turn.
- Otherwise pick a sensible default and record each defaulted choice as a short human-readable string in defaults_noted (empty array if nothing was defaulted).
- Exploratory intent — the user wants to browse rather than specify ("show me some ideas", "what could this look like", "not sure what style", "give me options") — is shape 3: exactly FOUR deliberately DIVERSE directions (e.g. four contrasting furniture styles, or staging vs renovation takes). Each direction has a short evocative label (2-4 words, e.g. "Warm Farmhouse") and its own edit_chain from the catalog. Diversity beats safety: no two directions may share the same furniture_style or read alike.
- Never output an edit_type or option key outside the catalog.`

// COPYWRITING (phase 13): listing photos + facts -> headline + 100w + 250w
// MLS descriptions. Tone shapes voice, never facts.
export const COPY_TONES: Record<string, { label: string; voice: string }> = {
  luxury: {
    label: "Luxury",
    voice:
      "Refined and aspirational. Lead with craftsmanship, materials, light, and lifestyle. Understated confidence — never gushing, no exclamation marks.",
  },
  family: {
    label: "Family",
    voice:
      "Warm and practical. Lead with livability: space to gather, storage, yard, nearby everyday life. Friendly plain language a busy parent skims.",
  },
  investor: {
    label: "Investor",
    voice:
      "Direct and numbers-forward. Lead with fundamentals: square footage, layout efficiency, condition, rentability, upside. No lifestyle fluff.",
  },
}

export const COPYWRITING_SYSTEM = `You write MLS real estate listing copy from the property photos and facts provided. Respond with a single JSON object and nothing else — no prose, no markdown, no code fences:
{"headline":"...","desc_100":"...","desc_250":"..."}

Rules:
- headline: one line, under 12 words, no address, no ALL CAPS.
- desc_100: approximately 100 words, one paragraph.
- desc_250: approximately 250 words, MLS-ready, 2-3 paragraphs separated by \\n\\n.
- Describe only what the photos and facts support. Never invent rooms, finishes, renovations, or neighborhood claims you cannot see or weren't told.
- Comply with fair-housing rules: describe the property, never the ideal buyer's demographics (no "perfect for young families", religion, nationality, etc.).
- Spell out the tone's voice throughout; facts stay identical across tones.`

  step: EditStep,
  comment?: string | null,
  grounding?: Grounding
): string {
  switch (step.edit_type) {
    case "ITEM_REMOVAL":
      return ITEM_REMOVAL(
        (step.options ?? {}) as { tier?: 1 | 2; items?: string },
        comment,
        grounding
      )
    case "IMAGE_ENHANCEMENT":
      return IMAGE_ENHANCEMENT((step.options ?? {}) as ImageEnhancementOptions, comment)
    case "TURN_ON_LIGHTS":
      return TURN_ON_LIGHTS(comment)
    case "VIRTUAL_STAGING":
      return VIRTUAL_STAGING((step.options ?? {}) as VirtualStagingOptions, comment, grounding)
    case "VIRTUAL_RENOVATION":
      return VIRTUAL_RENOVATION(
        (step.options ?? {}) as VirtualRenovationOptions,
        comment,
        grounding
      )
    case "VIRTUAL_LANDSCAPING":
      return VIRTUAL_LANDSCAPING((step.options ?? {}) as { instructions?: string }, comment)
    case "DAY_TO_DUSK":
      return DAY_TO_DUSK((step.options ?? {}) as { preset?: string }, comment)
    case "COLOUR_CHANGE":
      return COLOUR_CHANGE((step.options ?? {}) as { element?: string; colour?: string }, comment)
    case "SHADOW_REMOVAL":
      return SHADOW_REMOVAL(comment)
    case "FLOOR_PLAN_REDRAW":
      return FLOOR_PLAN_REDRAW(
        (step.options ?? {}) as FloorPlanRedrawOptions,
        comment,
        grounding
      )
    case "REWORK":
      // internal: instructions already carry the user's language; the group
      // comment belongs to the original chain, not the correction
      return REWORK(step.options as ReworkOptions)
    default:
      throw new Error(`No prompt template for edit type: ${step.edit_type}`)
  }
}
