// Phase 56: stable signed URLs. Supabase signed-URL tokens carry `iat`, so two
// calls a second apart never produce the same URL even with an identical
// expiresIn (verified 2026-09-03). Stability therefore needs both halves:
// (1) quantize the expiry to a whole-hour boundary so a token minted anywhere
// in the window is valid for the whole page lifetime, and (2) memoize the
// minted URL per (bucket, path, boundary) in this process so every render in
// the window reuses byte-identical URLs and the browser cache can hit.
// ponytail: the memo is process-local; separate Vercel instances mint their
// own token for the same window, so cache hits are per-instance there.

const HOUR_MS = 3_600_000
const MIN_HEADROOM_MS = 1_800_000 // a token is never handed out with < 30 min left

export type SignedUrlWindow = { boundaryMs: number; expiresInSeconds: number }

// nextBoundary = the next whole-hour mark at least (requested - 30 min) away,
// floored at 30 min. For the default 3600 s that is the next hour mark >= 30 min
// out, so expiresIn lands in [30, 90] min; a 6 h caller lands in [5.5, 6.5] h.
export function signedUrlWindow(requestedSeconds: number, nowMs = Date.now()): SignedUrlWindow {
  const minExpiryMs = Math.max(requestedSeconds * 1000 - MIN_HEADROOM_MS, MIN_HEADROOM_MS)
  const boundaryMs = Math.ceil((nowMs + minExpiryMs) / HOUR_MS) * HOUR_MS
  return { boundaryMs, expiresInSeconds: Math.ceil((boundaryMs - nowMs) / 1000) }
}

type Entry = { url: string; boundaryMs: number }

export class SignedUrlCache {
  private entries = new Map<string, Entry>()
  private readonly maxEntries: number
  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries
  }

  get size() {
    return this.entries.size
  }

  get(bucket: string, path: string, boundaryMs: number, nowMs = Date.now()): string | undefined {
    const entry = this.entries.get(`${bucket}/${path}`)
    if (!entry || entry.boundaryMs !== boundaryMs || entry.boundaryMs <= nowMs) return undefined
    return entry.url
  }

  set(bucket: string, path: string, boundaryMs: number, url: string, nowMs = Date.now()) {
    const key = `${bucket}/${path}`
    this.entries.delete(key) // re-insert so Map order stays least-recently-set first
    this.entries.set(key, { url, boundaryMs })
    if (this.entries.size > this.maxEntries) this.prune(nowMs)
  }

  // Drop expired entries, then oldest-set entries until under the cap.
  prune(nowMs = Date.now()) {
    for (const [key, entry] of this.entries) if (entry.boundaryMs <= nowMs) this.entries.delete(key)
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break
      this.entries.delete(key)
    }
  }
}
