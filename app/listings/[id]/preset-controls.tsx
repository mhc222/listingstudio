"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Disclosure } from "@/components/ui/disclosure"
import { Input } from "@/components/ui/input"
import {
  clonePresetChain,
  parseLegacyPreset,
  resolvePresetDefault,
  type EditPresetDefaultRow,
  type EditPresetRow,
  type PresetDefaultScope,
  type PresetSizePreset,
} from "@/lib/edit-presets"
import type { EditStep } from "@/lib/prompts"

function summaryLine(preset: EditPresetRow) {
  const edits = preset.settings_summary?.editLabels?.join(" → ") || "Saved edit"
  const size = preset.size_preset === "original"
    ? "Original size"
    : preset.size_preset === "under_10mb"
      ? "Under 10MB"
      : "Under 5MB"
  return `${edits} · ${size}`
}

async function responseJson(res: Response) {
  return (await res.json().catch(() => null)) as Record<string, unknown> | null
}

export function PresetControls({
  listingId,
  roomId,
  roomName,
  scopeLabel,
  targetCount,
  initialPresets,
  initialDefaults,
  currentChain,
  currentSizePreset,
  lastChain,
  onApply,
}: {
  listingId: string
  roomId: string | null
  roomName: string | null
  scopeLabel: string
  targetCount: number
  initialPresets: EditPresetRow[]
  initialDefaults: EditPresetDefaultRow[]
  currentChain: EditStep[]
  currentSizePreset: string
  lastChain: EditStep[] | null
  onApply: (chain: EditStep[], sizePreset: PresetSizePreset) => void
}) {
  const router = useRouter()
  const [presets, setPresets] = useState(initialPresets)
  const [defaults, setDefaults] = useState(initialDefaults)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preparedId, setPreparedId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [rename, setRename] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [legacy, setLegacy] = useState<{ editChain: EditStep[]; sizePreset: PresetSizePreset } | null>(null)
  const [legacyInvalid, setLegacyInvalid] = useState(false)
  const [legacyDismissed, setLegacyDismissed] = useState(false)
  const legacyKey = `ls:defaultChain:${listingId}`
  const preparedKey = `ls:preparedPreset:${listingId}`

  useEffect(() => setPresets(initialPresets), [initialPresets])
  useEffect(() => setDefaults(initialDefaults), [initialDefaults])
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(preparedKey)
      if (pending) {
        setPreparedId(pending)
        setSelectedId(pending)
      }
      const raw = localStorage.getItem(legacyKey)
      if (raw) {
        const parsed = parseLegacyPreset(raw)
        setLegacy({ editChain: parsed.editChain, sizePreset: parsed.sizePreset })
      }
    } catch {
      setLegacyInvalid(true)
    }
  }, [legacyKey, preparedKey])

  const effectiveDefault = useMemo(
    () => resolvePresetDefault({ defaults, listingId, roomId }),
    [defaults, listingId, roomId]
  )
  const effectivePreset = presets.find((preset) => preset.id === effectiveDefault?.preset_id) ?? null
  const selected = presets.find((preset) => preset.id === selectedId) ?? null

  function defaultLabel(presetId: string) {
    const matches = defaults.filter((item) => item.preset_id === presetId)
    const labels = matches.flatMap((item) => {
      if (item.scope_type === "account") return ["Account default"]
      if (item.scope_type === "listing" && item.listing_id === listingId) return ["Listing default"]
      if (item.scope_type === "room" && item.room_id === roomId) return [`${roomName ?? "Room"} default`]
      return []
    })
    return labels.join(" · ")
  }

  function applyPreset(preset: EditPresetRow) {
    onApply(clonePresetChain(preset.edit_chain), preset.size_preset)
    setSelectedId(preset.id)
    setMessage(`Applied “${preset.name}” to this editable draft. Nothing has started.`)
    if (preparedId === preset.id) {
      try { sessionStorage.removeItem(preparedKey) } catch { /* optional browser hint */ }
      setPreparedId(null)
    }
  }

  async function createPreset(input: { name: string; editChain: EditStep[]; sizePreset: string }, imported = false) {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch("/api/edit-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      const data = await responseJson(res)
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Could not save the preset.")
      const preset = data?.preset as EditPresetRow
      setPresets((items) => [...items, preset].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedId(preset.id)
      setName("")
      setMessage(`Saved “${preset.name}”.`)
      if (imported) {
        try { localStorage.removeItem(legacyKey) } catch { /* imported server copy is authoritative */ }
        setLegacy(null)
      }
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the preset.")
    } finally {
      setBusy(false)
    }
  }

  async function renamePreset() {
    if (!selected || !rename.trim() || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/edit-presets/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: rename }),
      })
      const data = await responseJson(res)
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Could not rename the preset.")
      const preset = data?.preset as EditPresetRow
      setPresets((items) => items.map((item) => item.id === preset.id ? preset : item).sort((a, b) => a.name.localeCompare(b.name)))
      setRename("")
      setMessage(`Renamed preset to “${preset.name}”. Historical edits were not changed.`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not rename the preset.")
    } finally {
      setBusy(false)
    }
  }

  async function deletePreset() {
    if (!selected || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/edit-presets/${selected.id}`, { method: "DELETE" })
      const data = await responseJson(res)
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Could not delete the preset.")
      setPresets((items) => items.filter((item) => item.id !== selected.id))
      setDefaults((items) => items.filter((item) => item.preset_id !== selected.id))
      setSelectedId(null)
      setMessage(`Deleted “${selected.name}”. Historical edits were not changed.`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete the preset.")
    } finally {
      setBusy(false)
    }
  }

  async function setDefault(scopeType: PresetDefaultScope) {
    if (!selected || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch("/api/edit-preset-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: selected.id,
          scopeType,
          listingId: scopeType === "account" ? null : listingId,
          roomId: scopeType === "room" ? roomId : null,
        }),
      })
      const data = await responseJson(res)
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Could not set the default.")
      const next = data?.default as EditPresetDefaultRow
      setDefaults((items) => [
        ...items.filter((item) => {
          if (item.scope_type !== next.scope_type) return true
          if (next.scope_type === "account") return false
          if (next.scope_type === "listing") return item.listing_id !== next.listing_id
          return item.room_id !== next.room_id
        }),
        next,
      ])
      setMessage(`“${selected.name}” is now the ${scopeType} default.`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not set the default.")
    } finally {
      setBusy(false)
    }
  }

  async function clearDefault(scopeType: PresetDefaultScope) {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch("/api/edit-preset-defaults", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeType,
          listingId: scopeType === "account" ? null : listingId,
          roomId: scopeType === "room" ? roomId : null,
        }),
      })
      const data = await responseJson(res)
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Could not clear the default.")
      setDefaults((items) => items.filter((item) => {
        if (item.scope_type !== scopeType) return true
        if (scopeType === "account") return false
        if (scopeType === "listing") return item.listing_id !== listingId
        return item.room_id !== roomId
      }))
      setMessage(`Cleared the ${scopeType} default.`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not clear the default.")
    } finally {
      setBusy(false)
    }
  }

  const accountDefault = defaults.find((item) => item.scope_type === "account")
  const listingDefault = defaults.find((item) => item.scope_type === "listing" && item.listing_id === listingId)
  const roomDefault = roomId
    ? defaults.find((item) => item.scope_type === "room" && item.room_id === roomId)
    : null

  return (
    <Disclosure
      className="mb-4 mt-3"
      summary={effectivePreset ? `Saved presets · ${effectivePreset.name} is recommended` : "Saved presets"}
      triggerClassName="px-1 text-xs font-semibold"
      contentClassName="px-1"
    >
      <div className="grid gap-3">
        <div className="rounded-lg bg-muted/55 p-3 text-xs">
          <p className="font-semibold">Apply to {scopeLabel} · {targetCount} photo{targetCount === 1 ? "" : "s"}</p>
          <p className="mt-1 text-muted-foreground">Review the included settings below. Applying only fills this draft; it never starts processing.</p>
        </div>

        {lastChain && (
          <button
            type="button"
            onClick={() => onApply(clonePresetChain(lastChain), currentSizePreset as PresetSizePreset)}
            className="ls-pressable min-h-10 rounded-lg border border-border/70 px-3 text-left text-sm font-medium hover:bg-muted"
          >
            ↻ Apply last edit <span className="font-normal text-muted-foreground">· recent action, not a saved preset</span>
          </button>
        )}

        {presets.length ? (
          <div className="grid gap-1.5" aria-label="Saved presets">
            {presets.map((preset) => {
              const chosen = selectedId === preset.id
              const label = defaultLabel(preset.id)
              return (
                <div key={preset.id} className={`rounded-lg border p-2.5 ${chosen ? "border-primary bg-primary/5" : "border-border/70"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => setSelectedId(preset.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-semibold">{preset.name}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{summaryLine(preset)}</span>
                      {label && <span className="mt-1 block text-[0.68rem] font-semibold text-primary">{label}</span>}
                      {preparedId === preset.id && <span className="mt-1 block text-[0.68rem] font-semibold text-primary">Prepared after upload — confirm this scope</span>}
                    </button>
                    <Button type="button" size="sm" variant={chosen ? "default" : "outline"} onClick={() => applyPreset(preset)}>
                      Apply
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No saved presets yet. Configure an edit below, then give it a name.</p>
        )}

        {legacy && !legacyDismissed && (
          <div className="rounded-lg border border-primary/35 bg-primary/5 p-3 text-xs">
            <p className="font-semibold">Import the old browser listing default?</p>
            <p className="mt-1 text-muted-foreground">It will be validated and saved to your account. Nothing changes until you confirm Import.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => createPreset({ name: "Imported listing default", editChain: legacy.editChain, sizePreset: legacy.sizePreset }, true)} disabled={busy}>Import</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setLegacyDismissed(true)}>Not now</Button>
            </div>
          </div>
        )}
        {legacyInvalid && <p className="text-xs text-destructive">The old browser default is invalid and was not imported. Your saved account presets are unaffected.</p>}

        {currentChain.length > 0 && (
          <div className="grid gap-2 rounded-lg border border-border/70 p-3">
            <label htmlFor="preset-name" className="text-xs font-semibold">Save this draft as a new preset</label>
            <div className="flex gap-2">
              <Input id="preset-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="MLS warm clean" maxLength={80} />
              <Button type="button" variant="outline" onClick={() => createPreset({ name, editChain: currentChain, sizePreset: currentSizePreset })} disabled={!name.trim() || busy}>Save</Button>
            </div>
          </div>
        )}

        {selected && (
          <div className="grid gap-2 rounded-lg bg-muted/45 p-3">
            <p className="text-xs font-semibold">Manage “{selected.name}”</p>
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="outline" onClick={() => setDefault("account")} disabled={busy}>Account default</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setDefault("listing")} disabled={busy}>Listing default</Button>
              {roomId && <Button type="button" size="sm" variant="outline" onClick={() => setDefault("room")} disabled={busy}>{roomName ?? "Room"} default</Button>}
            </div>
            {(accountDefault || listingDefault || roomDefault) && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {accountDefault && <button type="button" className="underline text-muted-foreground hover:text-foreground" onClick={() => clearDefault("account")}>Clear account default</button>}
                {listingDefault && <button type="button" className="underline text-muted-foreground hover:text-foreground" onClick={() => clearDefault("listing")}>Clear listing default</button>}
                {roomDefault && <button type="button" className="underline text-muted-foreground hover:text-foreground" onClick={() => clearDefault("room")}>Clear room default</button>}
              </div>
            )}
            <div className="flex gap-2">
              <Input value={rename} onChange={(event) => setRename(event.target.value)} placeholder="Rename preset" maxLength={80} />
              <Button type="button" size="sm" variant="outline" onClick={renamePreset} disabled={!rename.trim() || busy}>Rename</Button>
              <Button type="button" size="sm" variant="ghost" onClick={deletePreset} disabled={busy} className="text-destructive">Delete</Button>
            </div>
          </div>
        )}

        {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
      </div>
    </Disclosure>
  )
}
