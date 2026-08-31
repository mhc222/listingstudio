"use client"

import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { ROOM_TYPES } from "@/lib/roomTypes"
import { ENHANCEMENT_STYLES, FURNITURE_STYLES, LIGHT_PRESETS } from "@/lib/prompts"
import type { PhotoRow } from "./photo-grid"
import {
  EDIT_TYPES,
  RENOVATION_TIER_LABELS,
  SKY_STYLE_LABELS,
  type ChainEdit,
} from "./edit-types"

// konva touches window — client-only (same pattern as the aerial panel)
const MarkupCanvas = dynamic(
  () => import("@/components/markup-canvas").then((m) => m.MarkupCanvas),
  { ssr: false }
)

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
                <input
                  value={String(edit.options.items ?? "")}
                  onChange={(e) => onOption(i, "items", e.target.value)}
                  placeholder="e.g. the boxes and cat tree"
                  className="border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
                <input
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
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs text-muted-foreground">
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
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                Furniture style
                <Select
                  value={String(edit.options.furniture_style)}
                  onChange={(e) => onOption(i, "furniture_style", e.target.value)}
                >
                  {Object.entries(FURNITURE_STYLES).map(([k, { label }]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground sm:col-span-2">
                Furniture to include <span className="sr-only">(optional)</span>
                <input
                  value={String(edit.options.furniture_required ?? "")}
                  onChange={(e) => onOption(i, "furniture_required", e.target.value)}
                  placeholder="Optional · e.g. a king bed and reading chair"
                  className="border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
                  className="border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
            </div>
          )}
          {edit.edit_type === "VIRTUAL_LANDSCAPING" && (
            <div className="mt-2">
              <input
                value={String(edit.options.instructions ?? "")}
                onChange={(e) => onOption(i, "instructions", e.target.value)}
                placeholder="Optional extras, e.g. paint the front door navy, add porch furniture"
                className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
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
                <input
                  value={String(edit.options.element ?? "")}
                  onChange={(e) => onOption(i, "element", e.target.value)}
                  placeholder="e.g. the front door"
                  className="border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                New color
                <input
                  value={String(edit.options.colour ?? "")}
                  onChange={(e) => onOption(i, "colour", e.target.value)}
                  placeholder="e.g. deep navy blue"
                  className="border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
            </div>
          )}
        </div>
      ))}
    </>
  )
}
