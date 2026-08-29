// Darkroom brand primitives (phase 18): the mark, the wordmark lockups, and
// the state pill. Crop marks track the theme via currentColor; the room and
// floor rule stay signal teal (never the crop marks — spec rule).

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

// JetBrains Mono Bold uppercase .2em; LISTING full weight, STUDIO regular grey.
export function Wordmark({ stacked = false }: { stacked?: boolean }) {
  return (
    <span className={`flex items-center gap-3 ${stacked ? "flex-col gap-2.5" : ""}`}>
      <Mark size={stacked ? 44 : 26} />
      <span
        className={`font-mono text-sm font-bold uppercase leading-snug tracking-[0.2em] ${
          stacked ? "text-center tracking-[0.24em]" : "whitespace-nowrap"
        }`}
      >
        Listing{stacked ? <br /> : " "}
        <span className="font-normal text-muted-foreground">Studio</span>
      </span>
    </span>
  )
}

// State encoded twice — colour AND the left border stripe + dot — so it parses
// colour-blind and from four feet away. Job statuses map onto step states.
const PILL_STATES: Record<string, string> = {
  queued: "text-state-queued bg-state-queued/10",
  pending: "text-state-queued bg-state-queued/10",
  running: "text-state-running bg-state-running/10",
  processing: "text-state-running bg-state-running/10",
  complete: "text-state-complete bg-state-complete/10",
  failed: "text-state-failed bg-state-failed/10",
}

export function StatePill({ status, label }: { status: string; label?: string }) {
  // The dot breathes only while the system is actually acting — same rule as
  // the teal. A pulsing "complete" would make the signal meaningless.
  const live = status === "running" || status === "processing"
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border-l-2 border-current px-2 py-0.5 font-mono text-[0.66rem] font-bold uppercase tracking-[0.13em] ${
        PILL_STATES[status] ?? PILL_STATES.queued
      }`}
    >
      <span className={`size-[5px] shrink-0 rounded-full bg-current ${live ? "pulse-live" : ""}`} />
      {label ?? status}
    </span>
  )
}
