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

export function ITEM_REMOVAL(
  options: { tier?: 1 | 2; items?: string } = {},
  comment?: string | null
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

export function TURN_ON_LIGHTS(
  _options: Record<string, unknown> = {},
  comment?: string | null
): string {
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

export function compilePrompt(step: EditStep, comment?: string | null): string {
  switch (step.edit_type) {
    case "ITEM_REMOVAL":
      return ITEM_REMOVAL((step.options ?? {}) as { tier?: 1 | 2; items?: string }, comment)
    case "IMAGE_ENHANCEMENT":
      return IMAGE_ENHANCEMENT((step.options ?? {}) as ImageEnhancementOptions, comment)
    case "TURN_ON_LIGHTS":
      return TURN_ON_LIGHTS(step.options ?? {}, comment)
    default:
      throw new Error(`No prompt template for edit type: ${step.edit_type}`)
  }
}
