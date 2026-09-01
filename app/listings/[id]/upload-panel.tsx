"use client"

import { useMemo, useState } from "react"
import { Select } from "@/components/ui/select"
import { resolvePresetDefault, type EditPresetDefaultRow, type EditPresetRow } from "@/lib/edit-presets"
import { UploadQueue } from "./upload-queue"

export function UploadPanel({
  listingId,
  presets,
  presetDefaults,
}: {
  listingId: string
  presets: EditPresetRow[]
  presetDefaults: EditPresetDefaultRow[]
}) {
  const effective = useMemo(
    () => resolvePresetDefault({ defaults: presetDefaults, listingId }),
    [presetDefaults, listingId]
  )
  const [preparedId, setPreparedId] = useState("")
  const selected = presets.find((preset) => preset.id === preparedId)

  function prepare(id: string) {
    setPreparedId(id)
    try {
      if (id) sessionStorage.setItem(`ls:preparedPreset:${listingId}`, id)
      else sessionStorage.removeItem(`ls:preparedPreset:${listingId}`)
    } catch {
      // Preparation is an optional convenience; server presets remain intact.
    }
  }

  return (
    <div className="grid gap-3">
      <UploadQueue listingId={listingId} />
      {presets.length > 0 && (
        <section className="rounded-xl border border-border/70 bg-card/55 p-3" aria-labelledby="after-upload-title">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)] sm:items-end">
            <div>
              <h3 id="after-upload-title" className="text-sm font-semibold">After upload</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Prepare a saved preset, then select the exact photos or room below. You will review its scope and settings before applying; nothing starts automatically.
              </p>
            </div>
            <div>
              <label htmlFor="after-upload-preset" className="text-xs font-semibold">Preset for the next draft</label>
              <Select id="after-upload-preset" value={preparedId} onChange={(event) => prepare(event.target.value)}>
                <option value="">Choose after selecting photos</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}{preset.id === effective?.preset_id ? " · default" : ""}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {selected && (
            <p className="mt-2 text-xs text-muted-foreground">
              Includes {selected.settings_summary.editLabels.join(" → ")} · {selected.size_preset === "original" ? "Original size" : selected.size_preset === "under_10mb" ? "Under 10MB" : "Under 5MB"}. Scope is not chosen until you select photos.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
