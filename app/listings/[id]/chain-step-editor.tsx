"use client"

import dynamic from "next/dynamic"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { ROOM_TYPES } from "@/lib/roomTypes"
import { ENHANCEMENT_STYLES, FURNITURE_STYLES, LIGHT_PRESETS } from "@/lib/prompts"
import type { PhotoRow } from "./photo-grid"
import {
  EDIT_TYPES,
  FURNISHING_LEVEL_LABELS,
  RENOVATION_TIER_LABELS,
  SHOWCASE_LABELS,
  SKY_STYLE_LABELS,
  type ChainEdit,
} from "./edit-types"

// konva touches window — client-only (same pattern as the aerial panel)
const MarkupCanvas = dynamic(
  () => import("@/components/markup-canvas").then((m) => m.MarkupCanvas),
  { ssr: false }
)

const STAGING_SWATCHES: Record<string, { wall: string; floor: string; sofa: string; accent: string; wood: string }> = {
  modern: { wall: "#e8e7e3", floor: "#c8b494", sofa: "#4b4d4e", accent: "#f7f5ef", wood: "#b99768" },
  contemporary: { wall: "#e8e1d8", floor: "#b59675", sofa: "#a79a8c", accent: "#d9d2c8", wood: "#735a43" },
  farmhouse: { wall: "#f0ede4", floor: "#b78f61", sofa: "#ded6c6", accent: "#8d9b7b", wood: "#8f6946" },
  traditional: { wall: "#eee5d8", floor: "#8d6548", sofa: "#d4c3aa", accent: "#a57c3f", wood: "#5e382b" },
  urban_industrial: { wall: "#c7c3bb", floor: "#75553d", sofa: "#9a5d36", accent: "#414141", wood: "#6e4b31" },
  mid_century_modern: { wall: "#e7dccb", floor: "#9b6d48", sofa: "#b88b35", accent: "#427c79", wood: "#815532" },
  hamptons: { wall: "#f4f2ec", floor: "#d2c7b7", sofa: "#e3ded2", accent: "#405a78", wood: "#b89b72" },
  commercial: { wall: "#e5e6e5", floor: "#aaa9a4", sofa: "#777b7d", accent: "#f3f3f1", wood: "#a5a39d" },
  scandinavian: { wall: "#f1eee7", floor: "#c9ad81", sofa: "#d8d5cd", accent: "#b6a681", wood: "#b89463" },
}

function StyleSwatch({ styleKey }: { styleKey: string }) {
  const colors = STAGING_SWATCHES[styleKey] ?? STAGING_SWATCHES.modern
  return (
    <span className="relative block h-12 overflow-hidden rounded-lg" style={{ background: `linear-gradient(to bottom, ${colors.wall} 0 62%, ${colors.floor} 62% 100%)` }}>
      <span className="absolute bottom-2 left-2 h-4 w-10 rounded-[4px_4px_2px_2px] shadow-sm" style={{ background: colors.sofa }} />
      <span className="absolute bottom-1.5 left-3 h-1 w-0.5" style={{ background: colors.wood }} />
      <span className="absolute bottom-1.5 left-10 h-1 w-0.5" style={{ background: colors.wood }} />
      <span className="absolute bottom-2 right-2 h-3 w-4 rounded-sm" style={{ background: colors.wood }} />
      <span className="absolute bottom-5 right-[0.65rem] size-2 rounded-full" style={{ background: colors.accent }} />
      <span className="absolute right-[0.83rem] top-2 h-5 w-px bg-black/25" />
      <span className="absolute right-[0.55rem] top-1.5 h-2 w-2 rounded-full" style={{ background: colors.accent }} />
    </span>
  )
}

// The editable chain of edits with their per-type option forms. Shared by the
// interpreter-materialized path and the manual builder (phase 30).
export function ChainStepEditor({
  chain,
  photoIds,
  photoById,
  onOption,
  onRemove,
}: {
  chain: ChainEdit[]
  photoIds: string[]
  photoById: Map<string, PhotoRow>
  onOption: (index: number, key: string, value: unknown) => void
  onRemove: (index: number) => void
}) {
  return (
    <>
      {chain.map((edit, i) => (
        <div key={i} className={chain.length > 1 ? "mt-4 border-t border-border pt-4" : "mt-4"}>
          {chain.length > 1 && <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">
              Edit {i + 1} · {EDIT_TYPES[edit.edit_type]?.label ?? edit.edit_type}
            </p>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Remove
            </button>
          </div>}
          {["ITEM_REMOVAL", "360_ITEM_REMOVAL"].includes(edit.edit_type) && (
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                Removal scope
                <Select
                  value={Number(edit.options.tier)}
                  onChange={(e) => onOption(i, "tier", Number(e.target.value))}
                >
                  <option value={1}>Remove selected items</option>
                  <option value={2}>Clear the room</option>
                </Select>
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                What should be removed?
                <Input
                  value={String(edit.options.items ?? "")}
                  onChange={(e) => onOption(i, "items", e.target.value)}
                  placeholder="e.g. the boxes and cat tree"
                />
              </label>
            </div>
          )}
          {edit.edit_type === "MARKUP_EDIT" &&
            (photoIds.length !== 1 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Markup works one photo at a time — keep exactly one selected.
              </p>
            ) : edit.options.markup_path ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  Markup attached — {Number(edit.options.remove_count ?? 0)} remove,{" "}
                  {Number(edit.options.replace_count ?? 0)} replace. Describe replacements in
                  the comment field.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOption(i, "markup_path", undefined)
                    onOption(i, "remove_count", undefined)
                    onOption(i, "replace_count", undefined)
                  }}
                >
                  Redo markup
                </Button>
              </div>
            ) : (
              <div className="mt-2">
                <MarkupCanvas
                  src={photoById.get(photoIds[0])?.url ?? ""}
                  onAttach={(m) => {
                    onOption(i, "markup_path", m.markup_path)
                    onOption(i, "remove_count", m.remove_count)
                    onOption(i, "replace_count", m.replace_count)
                  }}
                />
              </div>
            ))}
          {edit.edit_type === "IMAGE_ENHANCEMENT" && (
            // style preset chips (phase 18 ride-along) — recorded on the
            // job record via the step options, default Natural
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {Object.entries(ENHANCEMENT_STYLES).map(([k, { label }]) => {
                const on = (edit.options.style_preset ?? "natural") === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => onOption(i, "style_preset", k)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${
                      on
                        ? "border-primary bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}
          {["IMAGE_ENHANCEMENT", "AERIAL_EDITING", "360_IMAGE_ENHANCEMENT"].includes(
            edit.edit_type
          ) && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <Input
                  type="checkbox"
                  checked={Boolean(edit.options.sky_replacement)}
                  onChange={(e) => onOption(i, "sky_replacement", e.target.checked)}
                />
                Sky replacement
              </label>
              {Boolean(edit.options.sky_replacement) && (
                <Select
                  value={String(edit.options.day_sky_style)}
                  onChange={(e) => onOption(i, "day_sky_style", e.target.value)}
                  className="w-auto"
                >
                  {Object.entries(SKY_STYLE_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={Boolean(edit.options.grass_repair)}
                  onChange={(e) => onOption(i, "grass_repair", e.target.checked)}
                />
                Grass repair
              </label>
            </div>
          )}
          {["VIRTUAL_STAGING", "360_VIRTUAL_STAGING"].includes(edit.edit_type) && (
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                Room type
                <Select
                  value={String(edit.options.room_type)}
                  onChange={(e) => onOption(i, "room_type", e.target.value)}
                >
                  {ROOM_TYPES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </label>
              <fieldset className="grid gap-2">
                <legend className="text-xs font-medium text-muted-foreground">Furniture style</legend>
                <div className="grid grid-cols-3 gap-1.5">
                  {Object.entries(FURNITURE_STYLES).map(([k, { label }]) => {
                    const selected = String(edit.options.furniture_style) === k
                    return (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onOption(i, "furniture_style", k)}
                        className={`ls-pressable relative min-w-0 rounded-xl p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${selected ? "bg-card text-foreground shadow-[0_0_0_2px_var(--primary),var(--shadow-surface)]" : "bg-card/65 text-muted-foreground hover:bg-card hover:text-foreground"}`}
                      >
                        <StyleSwatch styleKey={k} />
                        <span className="mt-1.5 block truncate text-[0.68rem] font-semibold" title={label}>{label}</span>
                        {selected && (
                          <span className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                            <Check aria-hidden="true" className="size-2.5" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              <div className="grid items-start gap-4">
                <fieldset className="grid self-start gap-2">
                  <legend className="text-xs font-medium text-muted-foreground">Furnishing level</legend>
                  <div className="grid grid-cols-2 rounded-xl bg-muted p-1">
                    {Object.entries(FURNISHING_LEVEL_LABELS).map(([k, label]) => {
                      const selected = String(edit.options.furnishing_level ?? "light") === k
                      return (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => onOption(i, "furnishing_level", k)}
                          className={`ls-pressable min-h-9 rounded-lg px-2 text-xs font-semibold ${selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
                <fieldset className="grid self-start gap-2">
                  <legend className="text-xs font-medium text-muted-foreground">Showcase</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(SHOWCASE_LABELS).map(([k, label]) => {
                      const selected = String(edit.options.showcase ?? "auto") === k
                      return (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => onOption(i, "showcase", k)}
                          className={`ls-pressable rounded-full px-2.5 py-1.5 text-xs font-medium ${selected ? "bg-accent text-accent-foreground shadow-sm" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
              </div>
              <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                Must include or avoid <span className="sr-only">(optional)</span>
                <Input
                  value={String(edit.options.furniture_required ?? "")}
                  onChange={(e) => onOption(i, "furniture_required", e.target.value)}
                  placeholder="Optional · e.g. include a reading chair; no wall art"
                />
              </label>
            </div>
          )}
          {edit.edit_type === "VIRTUAL_RENOVATION" && (
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                Renovation depth
                <Select
                  value={String(edit.options.tier)}
                  onChange={(e) => onOption(i, "tier", e.target.value)}
                >
                  {Object.entries(RENOVATION_TIER_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                What should change?
                <input
                  value={String(edit.options.changes ?? "")}
                  onChange={(e) => onOption(i, "changes", e.target.value)}
                  placeholder="e.g. white shaker cabinets and quartz counters"
                />
              </label>
            </div>
          )}
          {edit.edit_type === "VIRTUAL_LANDSCAPING" && (
            <div className="mt-2">
              <Input
                value={String(edit.options.instructions ?? "")}
                onChange={(e) => onOption(i, "instructions", e.target.value)}
                placeholder="Optional extras, e.g. paint the front door navy, add porch furniture"
                className="w-full"
              />
            </div>
          )}
          {edit.edit_type === "DAY_TO_DUSK" && (
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              Lighting
              <Select
                value={String(edit.options.preset)}
                onChange={(e) => onOption(i, "preset", e.target.value)}
              >
                {Object.entries(LIGHT_PRESETS).map(([k, { label }]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {edit.edit_type === "COLOUR_CHANGE" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                Surface or object
                <Input
                  value={String(edit.options.element ?? "")}
                  onChange={(e) => onOption(i, "element", e.target.value)}
                  placeholder="e.g. the front door"
                />
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                New color
                <Input
                  value={String(edit.options.colour ?? "")}
                  onChange={(e) => onOption(i, "colour", e.target.value)}
                  placeholder="e.g. deep navy blue"
                />
              </label>
            </div>
          )}
        </div>
      ))}
    </>
  )
}
