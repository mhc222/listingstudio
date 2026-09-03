// Phase 55 refresh discipline. Pure, dependency-free helpers shared by the
// upload queue and the live-refresh hook; exercised by
// scripts/test-refresh-discipline.mjs, which also records the before/after
// refresh and persist counts for the ACTIVE HANDOFF.

export type CoalesceOptions = {
  /** Debounce: wait this long after the latest request before running. */
  delayMs?: number
  /** Throttle: never run sooner than this after the previous run. */
  minIntervalMs?: number
  /** Starvation guard for the debounce: run no later than this after the first pending request. */
  maxWaitMs?: number
}

export type Coalesced = {
  /** Ask for one run. Repeated requests collapse into a single run. */
  request(overrides?: CoalesceOptions): void
  /** Run now, dropping any pending timer. */
  flush(): void
  /** Drop any pending run without running. */
  cancel(): void
  pending(): boolean
}

export function coalesce(run: () => void, defaults: CoalesceOptions = {}): Coalesced {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingSince = -1
  let lastRun = Number.NEGATIVE_INFINITY

  const fire = () => {
    timer = null
    pendingSince = -1
    lastRun = Date.now()
    run()
  }

  return {
    request(overrides) {
      const { delayMs = 0, minIntervalMs = 0, maxWaitMs = Number.POSITIVE_INFINITY } = {
        ...defaults,
        ...overrides,
      }
      const now = Date.now()
      if (pendingSince < 0) pendingSince = now
      const dueAt = Math.max(
        now,
        Math.min(pendingSince + maxWaitMs, Math.max(now + delayMs, lastRun + minIntervalMs))
      )
      if (timer) clearTimeout(timer)
      timer = setTimeout(fire, dueAt - now)
    },
    flush() {
      if (timer) clearTimeout(timer)
      fire()
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pendingSince = -1
    },
    pending: () => timer !== null,
  }
}

// Supabase Realtime caps an `in.(...)` filter at 100 values and long UUID
// lists can exceed the subscription index row size well before that
// (supabase/realtime#1670), so listing scopes are split into small bindings.
export const REALTIME_IN_CHUNK = 40

export function realtimeInFilters(column: string, ids: Iterable<string>, chunkSize = REALTIME_IN_CHUNK) {
  const unique = [...new Set(ids)].filter(Boolean)
  const filters: string[] = []
  for (let index = 0; index < unique.length; index += chunkSize) {
    filters.push(`${column}=in.(${unique.slice(index, index + chunkSize).join(",")})`)
  }
  return filters
}
