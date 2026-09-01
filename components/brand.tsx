// Brand primitives. Mark/Wordmark are the INTERIM Darkroom lockups —
// TODO(brand): mark/wordmark redesign is a flagged open decision (DECISIONS
// 2026-08-31); do not restyle piecemeal. StatePill is Editorial Luxury
// (phase 25): colored dot + tracked-uppercase label, no tinted fill.

export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path
        d="M7 15V7h8M41 15V7h-8M7 25v8h8M41 25v8h-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
      />
      <rect
        x="16"
        y="15"
        width="16"
        height="18"
        fill="none"
        className="stroke-primary"
        strokeWidth="2.6"
      />
      <rect x="4" y="38" width="40" height="3.2" className="fill-primary" />
    </svg>
  )
}

export function Wordmark({ stacked = false }: { stacked?: boolean }) {
  return (
    <span className={`flex items-center gap-3 ${stacked ? "flex-col gap-2.5" : ""}`}>
      <Mark size={stacked ? 44 : 26} />
      <span
        className={`font-ui text-[0.95rem] font-semibold leading-none tracking-[-0.025em] ${
          stacked ? "text-center text-lg" : "whitespace-nowrap"
        }`}
      >
        Listing{stacked ? <br /> : " "}
        <span className="font-medium text-muted-foreground">Studio</span>
      </span>
    </span>
  )
}

// State encoded twice — colour AND the dot + label form — so it parses
// colour-blind and from four feet away. Job statuses map onto step states.
// Editorial Luxury: no tinted fill, no border stripe — a quiet museum label.
const PILL_STATES: Record<string, string> = {
  queued: "text-state-queued",
  pending: "text-state-queued",
  running: "text-state-running",
  processing: "text-state-running",
  complete: "text-state-complete",
  failed: "text-state-failed",
  partial_failure: "text-state-failed",
}

export function StatePill({ status, label }: { status: string; label?: string }) {
  // The dot breathes only while the system is actually acting — same rule the
  // teal followed, now brass. A pulsing "complete" would make it meaningless.
  const live = status === "running" || status === "processing"
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-ui text-[0.68rem] font-semibold tracking-[0.02em] ${
        PILL_STATES[status] ?? PILL_STATES.queued
      }`}
    >
      <span className={`size-1.5 shrink-0 rounded-full bg-current ${live ? "pulse-live" : ""}`} />
      {label ?? status}
    </span>
  )
}
