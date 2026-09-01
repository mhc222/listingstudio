import type { EditStep } from "./prompts"

export const PRESET_SIZE_PRESETS = ["original", "under_10mb", "under_5mb"] as const
export type PresetSizePreset = (typeof PRESET_SIZE_PRESETS)[number]

export type PresetSummary = {
  version: 1
  editCount: number
  editLabels: string[]
  settings: Array<{ editType: string; label: string; values: string[] }>
  outputSize: PresetSizePreset
}

export type EditPresetRow = {
  id: string
  name: string
  edit_chain: EditStep[]
  size_preset: PresetSizePreset
  settings_summary: PresetSummary
  created_at: string
  updated_at: string
}

export type PresetDefaultScope = "account" | "listing" | "room"

export type EditPresetDefaultRow = {
  id: string
  preset_id: string
  scope_type: PresetDefaultScope
  listing_id: string | null
  room_id: string | null
  created_at: string
  updated_at: string
}

type OptionRule =
  | { kind: "boolean"; fallback: boolean; label: string }
  | { kind: "enum"; values: readonly (string | number)[]; fallback: string | number; label: string }
  | { kind: "string"; fallback: string; max: number; label: string }

type EditRule = {
  label: string
  options: Record<string, OptionRule>
}

const SKY_STYLES = ["any", "clear_blue", "clouds_blue", "orange_sunrise"] as const
const ROOM_TYPES = [
  "living_room", "kitchen", "dining", "main_bedroom", "bedroom_2", "bedroom_3",
  "bedroom_4", "bathroom_ensuite", "office", "outdoor_patio", "other",
] as const
const FURNITURE_STYLES = [
  "modern", "contemporary", "farmhouse", "traditional", "urban_industrial",
  "mid_century_modern", "hamptons", "commercial", "scandinavian",
] as const

// This is deliberately narrower than the execution catalog. Internal rework,
// one-off markup paths, floor-plan redraws, and other source-bound operations
// are not reusable photo presets.
export const PRESET_EDIT_CATALOG: Record<string, EditRule> = {
  ITEM_REMOVAL: {
    label: "Item removal",
    options: {
      tier: { kind: "enum", values: [1, 2], fallback: 1, label: "Removal" },
      items: { kind: "string", fallback: "", max: 500, label: "Items" },
    },
  },
  IMAGE_ENHANCEMENT: {
    label: "Image enhancement",
    options: {
      sky_replacement: { kind: "boolean", fallback: false, label: "Sky replacement" },
      day_sky_style: { kind: "enum", values: SKY_STYLES, fallback: "any", label: "Sky" },
      grass_repair: { kind: "boolean", fallback: false, label: "Lawn repair" },
      style_preset: {
        kind: "enum",
        values: ["natural", "bright_airy", "warm", "crisp"],
        fallback: "natural",
        label: "Finish",
      },
    },
  },
  TURN_ON_LIGHTS: { label: "Turn on lights", options: {} },
  VIRTUAL_STAGING: {
    label: "Virtual staging",
    options: {
      room_type: { kind: "enum", values: ROOM_TYPES, fallback: "other", label: "Room" },
      furniture_style: { kind: "enum", values: FURNITURE_STYLES, fallback: "modern", label: "Style" },
      furnishing_level: { kind: "enum", values: ["light", "standard"], fallback: "light", label: "Furnishing" },
      showcase: {
        kind: "enum",
        values: ["auto", "fireplace", "view", "conversation", "tv"],
        fallback: "auto",
        label: "Showcase",
      },
      furniture_required: { kind: "string", fallback: "", max: 500, label: "Requested furniture" },
    },
  },
  VIRTUAL_RENOVATION: {
    label: "Virtual renovation",
    options: {
      tier: { kind: "enum", values: ["light", "mid", "full"], fallback: "mid", label: "Depth" },
      changes: { kind: "string", fallback: "", max: 1000, label: "Changes" },
    },
  },
  VIRTUAL_LANDSCAPING: {
    label: "Virtual landscaping",
    options: { instructions: { kind: "string", fallback: "", max: 1000, label: "Instructions" } },
  },
  DAY_TO_DUSK: {
    label: "Day to dusk / relight",
    options: {
      preset: {
        kind: "enum",
        values: ["dusk", "bright_daylight", "golden_hour", "soft_overcast"],
        fallback: "dusk",
        label: "Light",
      },
    },
  },
  COLOUR_CHANGE: {
    label: "Color change",
    options: {
      element: { kind: "string", fallback: "", max: 200, label: "Element" },
      colour: { kind: "string", fallback: "", max: 120, label: "Color" },
    },
  },
  SHADOW_REMOVAL: { label: "Shadow removal", options: {} },
  AERIAL_EDITING: {
    label: "Aerial enhancement",
    options: {
      sky_replacement: { kind: "boolean", fallback: false, label: "Sky replacement" },
      day_sky_style: { kind: "enum", values: SKY_STYLES, fallback: "any", label: "Sky" },
      grass_repair: { kind: "boolean", fallback: false, label: "Lawn repair" },
    },
  },
  PORTRAIT_RETOUCHING: { label: "Portrait retouch", options: {} },
  "360_IMAGE_ENHANCEMENT": {
    label: "360 enhancement",
    options: {
      sky_replacement: { kind: "boolean", fallback: false, label: "Sky replacement" },
      day_sky_style: { kind: "enum", values: SKY_STYLES, fallback: "any", label: "Sky" },
      grass_repair: { kind: "boolean", fallback: false, label: "Lawn repair" },
    },
  },
  "360_ITEM_REMOVAL": {
    label: "360 item removal",
    options: {
      tier: { kind: "enum", values: [1, 2], fallback: 1, label: "Removal" },
      items: { kind: "string", fallback: "", max: 500, label: "Items" },
    },
  },
  "360_VIRTUAL_STAGING": {
    label: "360 virtual staging",
    options: {
      room_type: { kind: "enum", values: ROOM_TYPES, fallback: "other", label: "Room" },
      furniture_style: { kind: "enum", values: FURNITURE_STYLES, fallback: "modern", label: "Style" },
      furnishing_level: { kind: "enum", values: ["light", "standard"], fallback: "light", label: "Furnishing" },
      showcase: {
        kind: "enum",
        values: ["auto", "fireplace", "view", "conversation", "tv"],
        fallback: "auto",
        label: "Showcase",
      },
      furniture_required: { kind: "string", fallback: "", max: 500, label: "Requested furniture" },
    },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function cleanName(value: unknown) {
  if (typeof value !== "string") throw new Error("Preset name is required.")
  const name = value.trim().replace(/\s+/g, " ")
  if (!name || name.length > 80) throw new Error("Preset name must be between 1 and 80 characters.")
  return name
}

function sanitizeOption(key: string, value: unknown, rule: OptionRule) {
  if (value === undefined) return rule.fallback
  if (rule.kind === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${key} must be true or false.`)
    return value
  }
  if (rule.kind === "enum") {
    if (!rule.values.includes(value as never)) throw new Error(`${key} is not a supported value.`)
    return value as string | number
  }
  if (typeof value !== "string") throw new Error(`${key} must be text.`)
  const result = value.trim()
  if (result.length > rule.max) throw new Error(`${key} is too long.`)
  return result
}

export function sanitizePresetChain(raw: unknown): EditStep[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) {
    throw new Error("A preset needs between 1 and 8 ordered edits.")
  }
  return raw.map((value, index) => {
    if (!isRecord(value) || typeof value.edit_type !== "string") {
      throw new Error(`Edit ${index + 1} is invalid.`)
    }
    const rule = PRESET_EDIT_CATALOG[value.edit_type]
    if (!rule) throw new Error(`${value.edit_type} cannot be saved as a reusable preset.`)
    const rawOptions = value.options === undefined ? {} : value.options
    if (!isRecord(rawOptions)) throw new Error(`Options for ${rule.label} must be an object.`)
    const unknown = Object.keys(rawOptions).filter((key) => !rule.options[key])
    if (unknown.length) throw new Error(`${rule.label} contains unsupported setting “${unknown[0]}”.`)
    return {
      edit_type: value.edit_type,
      options: Object.fromEntries(
        Object.entries(rule.options).map(([key, optionRule]) => [
          key,
          sanitizeOption(key, rawOptions[key], optionRule),
        ])
      ),
    }
  })
}

function readable(value: unknown) {
  if (typeof value === "boolean") return value ? "On" : "Off"
  if (typeof value === "number") return String(value)
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function buildPresetSummary(chain: EditStep[], sizePreset: PresetSizePreset): PresetSummary {
  return {
    version: 1,
    editCount: chain.length,
    editLabels: chain.map((step) => PRESET_EDIT_CATALOG[step.edit_type]?.label ?? step.edit_type),
    settings: chain.map((step) => {
      const rule = PRESET_EDIT_CATALOG[step.edit_type]
      const values = Object.entries(step.options ?? {})
        .filter(([, value]) => value !== "")
        .map(([key, value]) => `${rule?.options[key]?.label ?? key}: ${readable(value)}`)
      return { editType: step.edit_type, label: rule?.label ?? step.edit_type, values }
    }),
    outputSize: sizePreset,
  }
}

export function validatePresetInput(raw: unknown) {
  if (!isRecord(raw)) throw new Error("Preset details are required.")
  const name = cleanName(raw.name)
  const editChain = sanitizePresetChain(raw.editChain)
  const sizePreset = PRESET_SIZE_PRESETS.includes(raw.sizePreset as PresetSizePreset)
    ? (raw.sizePreset as PresetSizePreset)
    : "original"
  return {
    name,
    editChain,
    sizePreset,
    settingsSummary: buildPresetSummary(editChain, sizePreset),
  }
}

export function validatePresetName(raw: unknown) {
  return cleanName(raw)
}

export function resolvePresetDefault({
  defaults,
  listingId,
  roomId,
}: {
  defaults: EditPresetDefaultRow[]
  listingId: string
  roomId?: string | null
}) {
  if (roomId) {
    const room = defaults.find((item) => item.scope_type === "room" && item.room_id === roomId)
    if (room) return room
  }
  const listing = defaults.find(
    (item) => item.scope_type === "listing" && item.listing_id === listingId
  )
  return listing ?? defaults.find((item) => item.scope_type === "account") ?? null
}

export function clonePresetChain(chain: EditStep[]) {
  return chain.map((step) => ({ edit_type: step.edit_type, options: { ...(step.options ?? {}) } }))
}

export function parseLegacyPreset(raw: string) {
  return validatePresetInput({ name: "Imported listing default", editChain: JSON.parse(raw), sizePreset: "original" })
}
