"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { StatePill } from "@/components/brand"
import { createClient } from "@/lib/supabase/client"

export type ReelSource = {
  key: string // `${kind}:${id}`
  kind: "photo" | "output"
  id: string
  url: string | null
  label: string
}

export type ReelRecord = {
  id: string
  status: string
  format: string
  error: string | null
  music: string | null
  clip_count: number
}

const PILL_MAP: Record<string, string> = { rendering: "running" }

export function ReelPanel({
  listingId,
  sources,
  reels,
  musicTracks,
}: {
  listingId: string
  sources: ReelSource[]
  reels: ReelRecord[]
  musicTracks: string[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [format, setFormat] = useState<"9:16" | "16:9">("9:16")
  const [music, setMusic] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`reels-${listingId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "reels" }, () =>
        router.refresh()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [listingId, router])

  function toggle(key: string) {
    setSelected((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= 20 ? cur : [...cur, key]
    )
  }

  async function generate() {
    setBusy(true)
    setError(null)
    const clips = selected.map((key) => {
      const s = sources.find((x) => x.key === key)!
      return { kind: s.kind, id: s.id }
    })
    const res = await fetch("/api/reels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId, clips, format, music: music || null }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? `request failed (${res.status})`)
      return
    }
    setSelected([])
    router.refresh()
  }

  if (sources.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 text-lg font-medium">Listing reel</h2>
      <div className="rounded-lg border p-4">
        <p className="mb-2 text-sm text-muted-foreground">
          Pick photos in the order they should play (~3s each, crossfaded, address caption
          overlaid). Edited outputs listed first.
        </p>
        <div className="flex flex-wrap gap-2">
          {sources.map((s) => {
            const pos = selected.indexOf(s.key)
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                className={`relative h-20 w-28 overflow-hidden rounded border ${
                  pos >= 0 ? "border-primary ring-2 ring-primary" : "border-border"
                }`}
                title={s.label}
              >
                {s.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt={s.label} className="size-full object-cover" />
                ) : (
                  <span className="text-xs">?</span>
                )}
                <span className="absolute bottom-0 left-0 bg-black/60 px-1 font-mono text-[0.6rem] uppercase tracking-wider text-white">
                  {s.label}
                </span>
                {pos >= 0 && (
                  <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary font-mono text-xs font-bold text-primary-foreground">
                    {pos + 1}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex rounded border">
            {(["9:16", "16:9"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={`px-3 py-1.5 font-mono text-xs ${
                  format === f ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {f === "9:16" ? "9:16 Reel" : "16:9 Wide"}
              </button>
            ))}
          </div>
          <select
            value={music}
            onChange={(e) => setMusic(e.target.value)}
            className="rounded border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">No music</option>
            {musicTracks.map((t) => (
              <option key={t} value={t}>
                {t.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ")}
              </option>
            ))}
          </select>
          <Button onClick={generate} disabled={busy || selected.length < 2}>
            {busy ? "Queuing…" : `Generate reel${selected.length >= 2 ? ` ×${selected.length}` : ""}`}
          </Button>
        </div>
        {musicTracks.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            No music tracks bundled — drop royalty-free .mp3 files in assets/music.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-state-failed">{error}</p>}

        {reels.length > 0 && (
          <ul className="mt-4 grid gap-2 border-t pt-3">
            {reels.map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-sm">
                <StatePill status={PILL_MAP[r.status] ?? r.status} label={r.status} />
                <span className="font-mono text-xs text-muted-foreground">
                  {r.format} · {r.clip_count} photos{r.music ? " · music" : ""}
                </span>
                {r.status === "complete" && (
                  <a href={`/api/reels/${r.id}/download`} className="text-primary hover:underline">
                    Download MP4
                  </a>
                )}
                {r.status === "failed" && (
                  <span className="truncate text-xs text-state-failed">{r.error}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
