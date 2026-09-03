"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import { coalesce } from "@/lib/refresh-discipline"

export const LIVE_REFRESH_DEBOUNCE_MS = 1000
export const RECONCILE_POLL_MS = 5000

// router.refresh() re-runs every server query on the page and re-mints every
// signed image URL, so realtime bursts (a FileGroup update followed by its
// output_versions insert and QA note) collapse into one refresh about a second
// after the last event, and never later than two seconds after the first.
export function useDebouncedRefresh(delayMs = LIVE_REFRESH_DEBOUNCE_MS) {
  const router = useRouter()
  const runner = useMemo(
    () => coalesce(() => router.refresh(), { delayMs, maxWaitMs: delayMs * 2 }),
    [delayMs, router]
  )
  useEffect(() => () => runner.cancel(), [runner])
  return useCallback(() => runner.request(), [runner])
}

type ReconcileResponse = { checked?: number; changed?: number; fingerprint?: string }

// Production finishes via fal webhooks; localhost cannot receive them, so an
// open page polls the authenticated listing-scoped reconciliation endpoint
// while work is in flight. The refresh is gated: only when this poll settled a
// step (`changed > 0`) or the set of running FileGroups differs from the
// previous poll (a webhook landed in between) does the page re-render.
export function useReconcilePoll({
  listingId,
  active,
  refresh,
}: {
  listingId: string
  active: boolean
  refresh: () => void
}) {
  const fingerprint = useRef<string | null>(null)
  useEffect(() => {
    if (!active) return
    fingerprint.current = null
    let cancelled = false
    const reconcile = async () => {
      try {
        const response = await fetch(`/api/listings/${listingId}/reconcile`, { method: "POST" })
        if (!response.ok || cancelled) return
        const body = (await response.json()) as ReconcileResponse
        const previous = fingerprint.current
        const next = body.fingerprint ?? ""
        fingerprint.current = next
        if ((body.changed ?? 0) > 0 || (previous !== null && next !== previous)) refresh()
      } catch {
        // A transient offline tab should not turn status refresh into a UI
        // error; the next poll or a realtime event recovers.
      }
    }
    void reconcile()
    const timer = window.setInterval(reconcile, RECONCILE_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active, listingId, refresh])
}
