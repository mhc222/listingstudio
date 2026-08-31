// Shared edit-type catalog + label maps for the composer, the per-step editor,
// and the job feed (phase 30 — extracted from the old job-panel.tsx).

export type ChainEdit = { edit_type: string; options: Record<string, unknown> }

export const EDIT_TYPES: Record<string, { label: string; defaults: Record<string, unknown> }> = {
  ITEM_REMOVAL: { label: "Item removal", defaults: { tier: 1, items: "" } },
  // markup-to-edit (phase 23): drag-drawn marks drive the edit; gemini-only
  MARKUP_EDIT: { label: "Markup edit (draw on the photo)", defaults: {} },
  IMAGE_ENHANCEMENT: {
    label: "Image enhancement",
    defaults: {
      sky_replacement: false,
      day_sky_style: "any",
      grass_repair: false,
      style_preset: "natural",
    },
  },
  TURN_ON_LIGHTS: { label: "Turn on lights", defaults: {} },
  VIRTUAL_STAGING: {
    label: "Virtual staging",
    defaults: { room_type: "living_room", furniture_style: "modern", furniture_required: "" },
  },
  VIRTUAL_RENOVATION: {
    label: "Virtual renovation",
    defaults: { tier: "mid", changes: "" },
  },
  VIRTUAL_LANDSCAPING: { label: "Virtual landscaping", defaults: { instructions: "" } },
  DAY_TO_DUSK: { label: "Day to dusk / relight", defaults: { preset: "dusk" } },
  COLOUR_CHANGE: { label: "Colour change", defaults: { element: "", colour: "" } },
  SHADOW_REMOVAL: { label: "Shadow removal", defaults: {} },
  AERIAL_EDITING: {
    label: "Aerial enhancement",
    defaults: { sky_replacement: false, day_sky_style: "any", grass_repair: false },
  },
  PORTRAIT_RETOUCHING: { label: "Portrait retouch", defaults: {} },
  // Experimental 360 edits (phase 17): equirect (2:1) input only, output
  // flagged for manual seam/pole review
  "360_IMAGE_ENHANCEMENT": {
    label: "360 enhancement (experimental)",
    defaults: { sky_replacement: false, day_sky_style: "any", grass_repair: false },
  },
  "360_ITEM_REMOVAL": { label: "360 item removal (experimental)", defaults: { tier: 1, items: "" } },
  "360_VIRTUAL_STAGING": {
    label: "360 virtual staging (experimental)",
    defaults: { room_type: "living_room", furniture_style: "modern", furniture_required: "" },
  },
}

export const EDIT_360_TYPES = ["360_IMAGE_ENHANCEMENT", "360_ITEM_REMOVAL", "360_VIRTUAL_STAGING"]

export const RENOVATION_TIER_LABELS: Record<string, string> = {
  light: "Light touch",
  mid: "Mid renovation",
  full: "Full renovation",
}

export const SKY_STYLE_LABELS: Record<string, string> = {
  any: "Any sky",
  clear_blue: "Clear blue",
  clouds_blue: "Clouds + blue",
  orange_sunrise: "Orange sunrise",
}

export const SIZE_PRESETS: Record<string, string> = {
  original: "Original size",
  under_10mb: "Under 10MB",
  under_5mb: "Under 5MB",
}
