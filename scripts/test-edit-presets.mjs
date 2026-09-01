import assert from "node:assert/strict"
import fs from "node:fs"
import {
  buildPresetSummary,
  clonePresetChain,
  parseLegacyPreset,
  resolvePresetDefault,
  sanitizePresetChain,
  validatePresetInput,
} from "../lib/edit-presets.ts"

let assertions = 0
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message)
  assertions += 1
}
function throws(fn, pattern, message) {
  assert.throws(fn, pattern, message)
  assertions += 1
}

const chain = sanitizePresetChain([
  { edit_type: "IMAGE_ENHANCEMENT", options: { style_preset: "warm", sky_replacement: false } },
  { edit_type: "TURN_ON_LIGHTS", options: {} },
])
equal(chain.length, 2, "keeps ordered chain")
equal(chain[0].options.style_preset, "warm", "keeps a valid finish")
equal(chain[0].options.day_sky_style, "any", "fills current catalog defaults")
equal(chain[1].options, {}, "supports settings-free edits")

throws(() => sanitizePresetChain([]), /between 1 and 8/, "rejects empty chains")
throws(() => sanitizePresetChain([{ edit_type: "REWORK", options: {} }]), /cannot be saved/, "rejects internal edits")
throws(() => sanitizePresetChain([{ edit_type: "MARKUP_EDIT", options: {} }]), /cannot be saved/, "rejects source-bound markup")
throws(
  () => sanitizePresetChain([{ edit_type: "IMAGE_ENHANCEMENT", options: { provider: "secret" } }]),
  /unsupported setting/,
  "rejects unknown options"
)
throws(
  () => sanitizePresetChain([{ edit_type: "VIRTUAL_STAGING", options: { room_type: "garage" } }]),
  /not a supported value/,
  "rejects invalid enums"
)
throws(
  () => sanitizePresetChain([{ edit_type: "COLOUR_CHANGE", options: { element: true } }]),
  /must be text/,
  "rejects wrong option types"
)

const input = validatePresetInput({ name: "  MLS   warm clean ", editChain: chain, sizePreset: "under_10mb" })
equal(input.name, "MLS warm clean", "normalizes names")
equal(input.sizePreset, "under_10mb", "keeps output size")
equal(input.settingsSummary.editLabels, ["Image enhancement", "Turn on lights"], "summarizes included edits")
equal(input.settingsSummary.outputSize, "under_10mb", "summary includes output size")

const cloned = clonePresetChain(chain)
cloned[0].options.style_preset = "crisp"
equal(chain[0].options.style_preset, "warm", "draft override cannot mutate preset definition")

const defaults = [
  { id: "a", preset_id: "pa", scope_type: "account", listing_id: null, room_id: null },
  { id: "l", preset_id: "pl", scope_type: "listing", listing_id: "listing", room_id: null },
  { id: "r", preset_id: "pr", scope_type: "room", listing_id: "listing", room_id: "room" },
]
equal(resolvePresetDefault({ defaults, listingId: "listing", roomId: "room" })?.preset_id, "pr", "room wins")
equal(resolvePresetDefault({ defaults, listingId: "listing", roomId: "other" })?.preset_id, "pl", "listing wins")
equal(resolvePresetDefault({ defaults, listingId: "other", roomId: null })?.preset_id, "pa", "account is fallback")

const legacy = parseLegacyPreset(JSON.stringify([{ edit_type: "DAY_TO_DUSK", options: { preset: "golden_hour" } }]))
equal(legacy.name, "Imported listing default", "legacy import is explicit")
equal(legacy.editChain[0].options.preset, "golden_hour", "legacy chain is sanitized")
throws(() => parseLegacyPreset("not-json"), /Unexpected token|JSON/, "corrupt legacy data is rejected")

const summary = buildPresetSummary(chain, "original")
equal(summary.editCount, 2, "summary count matches chain")
equal(summary.settings[0].values.includes("Finish: Warm"), true, "summary exposes included option")

const migration = fs.readFileSync("supabase/migrations/0014_edit_presets.sql", "utf8")
const createRoute = fs.readFileSync("app/api/edit-presets/route.ts", "utf8")
const presetUi = fs.readFileSync("app/listings/[id]/preset-controls.tsx", "utf8")
const uploadUi = fs.readFileSync("app/listings/[id]/upload-panel.tsx", "utf8")
const composer = fs.readFileSync("app/listings/[id]/composer.tsx", "utf8")
equal(migration.includes("edit_presets_user_name_unique"), true, "schema enforces unique account names")
equal(migration.includes("scope_type = 'room'"), true, "schema models room defaults")
equal(migration.includes("preset must belong to default owner"), true, "schema checks cross-owner defaults")
equal(migration.includes("enable row level security"), true, "schema enables RLS")
equal(migration.includes('policy "read own edit presets"'), true, "authenticated preset access is read-only")
equal(migration.includes('policy "own edit presets" on edit_presets for all'), false, "direct client writes cannot bypass validation")
equal(createRoute.includes("validatePresetInput(await req.json())"), true, "create route validates before mutation")
equal(createRoute.includes("createAdminClient()"), true, "validated server route owns privileged mutation")
equal(presetUi.includes("Applying only fills this draft; it never starts processing."), true, "application is explicit and non-running")
equal(presetUi.includes("Historical edits were not changed."), true, "rename/delete copy states history boundary")
equal(presetUi.includes("parseLegacyPreset(raw)"), true, "legacy import is validated")
equal(presetUi.includes("localStorage.removeItem(legacyKey)"), true, "confirmed import retires the browser source")
equal(uploadUi.includes("nothing starts automatically"), true, "intake preparation does not auto-run")
equal(uploadUi.includes("Scope is not chosen until you select photos."), true, "intake copy keeps scope honest")
equal(composer.includes("ls:defaultChain:"), false, "composer no longer treats local storage as default truth")

console.log(`edit preset contract: ${assertions} assertions passed`)
