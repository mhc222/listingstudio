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
    default:
      throw new Error(`No prompt template for edit type: ${step.edit_type}`)
  }
}
