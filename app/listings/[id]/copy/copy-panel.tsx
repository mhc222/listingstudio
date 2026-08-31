"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { COPY_TONES } from "@/lib/prompts"

export type CopyRow = {
  id: string
  tone: string
  facts: { beds?: string; baths?: string; sqft?: string; features?: string }
  headline: string
  desc_100: string
  desc_250: string
}

type PhotoThumb = { id: string; url: string | null }

function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!text.trim()}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? "Copied ✓" : "Copy"}
    </Button>
  )
}

export function CopyPanel({
  listingId,
  photos,
  copies,
}: {
  listingId: string
  photos: PhotoThumb[]
  copies: CopyRow[]
}) {
  const [byTone, setByTone] = useState<Record<string, CopyRow>>(() =>
    Object.fromEntries(copies.map((c) => [c.tone, c]))
  )
  const [tone, setTone] = useState("luxury")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [beds, setBeds] = useState(copies[0]?.facts?.beds ?? "")
  const [baths, setBaths] = useState(copies[0]?.facts?.baths ?? "")
  const [sqft, setSqft] = useState(copies[0]?.facts?.sqft ?? "")
  const [features, setFeatures] = useState(copies[0]?.facts?.features ?? "")
  const [headline, setHeadline] = useState(copies.find((c) => c.tone === "luxury")?.headline ?? "")
  const [desc100, setDesc100] = useState(copies.find((c) => c.tone === "luxury")?.desc_100 ?? "")
  const [desc250, setDesc250] = useState(copies.find((c) => c.tone === "luxury")?.desc_250 ?? "")
  const [busy, setBusy] = useState<"generate" | "save" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  function switchTone(next: string) {
    setTone(next)
    const row = byTone[next]
    setHeadline(row?.headline ?? "")
    setDesc100(row?.desc_100 ?? "")
    setDesc250(row?.desc_250 ?? "")
    setError(null)
    setSavedAt(null)
  }

  function togglePhoto(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function generate() {
    if (busy) return
    setBusy("generate")
    setError(null)
    const res = await fetch(`/api/listings/${listingId}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        photoIds: [...selected],
        facts: { beds, baths, sqft, features },
        tone,
      }),
    })
    setBusy(null)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error ?? `request failed (${res.status})`)
      return
    }
    const row = data as CopyRow
    setByTone((prev) => ({ ...prev, [tone]: row }))
    setHeadline(row.headline)
    setDesc100(row.desc_100)
    setDesc250(row.desc_250)
  }

  async function save() {
    if (busy || !byTone[tone]) return
    setBusy("save")
    setError(null)
    const res = await fetch(`/api/listings/${listingId}/copy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tone, headline, desc_100: desc100, desc_250: desc250 }),
    })
    setBusy(null)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error ?? `request failed (${res.status})`)
      return
    }
    setByTone((prev) => ({ ...prev, [tone]: data as CopyRow }))
    setSavedAt(Date.now())
  }

  const hasCopy = Boolean(headline || desc100 || desc250)

  return (
    <div className="grid gap-6">
      <section>
        <h2 className="mb-2 text-sm font-medium">Photos ({selected.size} selected)</h2>
        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Upload photos on the listing page first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePhoto(p.id)}
                className={`h-20 w-28 overflow-hidden rounded border-2 ${
                  selected.has(p.id) ? "border-state-complete" : "border-transparent"
                }`}
              >
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-muted" />
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-4">
        <label className="grid gap-1 text-sm">
          Beds
          <input
            value={beds}
            onChange={(e) => setBeds(e.target.value)}
            className="rounded border px-2 py-1"
            inputMode="numeric"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Baths
          <input
            value={baths}
            onChange={(e) => setBaths(e.target.value)}
            className="rounded border px-2 py-1"
            inputMode="numeric"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Sq ft
          <input
            value={sqft}
            onChange={(e) => setSqft(e.target.value)}
            className="rounded border px-2 py-1"
            inputMode="numeric"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Tone
          <Select
            value={tone}
            onChange={(e) => switchTone(e.target.value)}
            className="w-auto"
          >
            {Object.entries(COPY_TONES).map(([key, t]) => (
              <option key={key} value={key}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm sm:col-span-4">
          Notable features
          <textarea
            value={features}
            onChange={(e) => setFeatures(e.target.value)}
            rows={2}
            placeholder="e.g. renovated kitchen, corner lot, new roof 2024, walk to the beach"
            className="rounded border px-2 py-1"
          />
        </label>
      </section>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={generate} disabled={busy !== null || selected.size === 0}>
          {busy === "generate"
            ? "Generating…"
            : byTone[tone]
              ? `Regenerate (${COPY_TONES[tone].label})`
              : `Generate (${COPY_TONES[tone].label})`}
        </Button>
        {selected.size === 0 && (
          <span className="text-sm text-muted-foreground">Select at least one photo</span>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      {hasCopy && (
        <section className="grid gap-5">
          <div className="grid gap-1">
            <div className="flex items-center justify-between">
              <label htmlFor="copy-headline" className="text-sm font-medium">
                Headline
              </label>
              <CopyButton text={headline} />
            </div>
            <input
              id="copy-headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              className="rounded border px-2 py-1 text-lg"
            />
          </div>
          <div className="grid gap-1">
            <div className="flex items-center justify-between">
              <label htmlFor="copy-100" className="text-sm font-medium">
                100-word description ({wordCount(desc100)} words)
              </label>
              <CopyButton text={desc100} />
            </div>
            <textarea
              id="copy-100"
              value={desc100}
              onChange={(e) => setDesc100(e.target.value)}
              rows={5}
              className="rounded border px-2 py-1"
            />
          </div>
          <div className="grid gap-1">
            <div className="flex items-center justify-between">
              <label htmlFor="copy-250" className="text-sm font-medium">
                250-word MLS description ({wordCount(desc250)} words)
              </label>
              <CopyButton text={desc250} />
            </div>
            <textarea
              id="copy-250"
              value={desc250}
              onChange={(e) => setDesc250(e.target.value)}
              rows={12}
              className="rounded border px-2 py-1"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={save} disabled={busy !== null}>
              {busy === "save" ? "Saving…" : "Save edits"}
            </Button>
            {savedAt && <span className="text-sm text-state-complete">Saved ✓</span>}
          </div>
        </section>
      )}
    </div>
  )
}
