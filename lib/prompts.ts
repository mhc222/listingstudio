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

export function compilePrompt(
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
    default:
      throw new Error(`No prompt template for edit type: ${step.edit_type}`)
  }
}
