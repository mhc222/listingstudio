"use client"

import { useRef, useState } from "react"

// Interactive before/after slider for the public landing. Drag anywhere on the
// image or use the range input (keyboard-accessible). Images are static files
// in public/demo/ so the landing stays data-free; if a file is missing the
// frame degrades to a labeled placeholder rather than a broken <img>.
export function BeforeAfterDemo({
  before,
  after,
  caption,
}: {
  before: string
  after: string
  caption?: string
}) {
  const [pos, setPos] = useState(50)
  const [beforeOk, setBeforeOk] = useState(true)
  const [afterOk, setAfterOk] = useState(true)
  const frame = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  function moveTo(clientX: number) {
    const el = frame.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const p = ((clientX - rect.left) / rect.width) * 100
    setPos(Math.min(100, Math.max(0, p)))
  }

  return (
    <figure className="m-0">
      <div
        ref={frame}
        className="relative aspect-[3/2] w-full cursor-ew-resize select-none overflow-hidden rounded-lg border border-border bg-muted"
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          moveTo(e.clientX)
        }}
        onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
      >
        <Layer ok={beforeOk} src={before} label="Before" onError={() => setBeforeOk(false)} />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
          <Layer
            ok={afterOk}
            src={after}
            label="After"
            after
            onError={() => setAfterOk(false)}
          />
        </div>

        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-white/90">
          Before
        </span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-white/90">
          After
        </span>

        {/* Divider + grab handle */}
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/90 shadow"
          style={{ left: `${pos}%` }}
        >
          <span className="absolute left-1/2 top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow-md">
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9 6L4 12l5 6M15 6l5 6-5 6"
                fill="none"
                stroke="#241F1A"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Reveal the edited photo"
        className="mt-3 w-full accent-[var(--brass)]"
      />
      {caption && (
        <figcaption className="mt-1 text-xs text-muted-foreground">{caption}</figcaption>
      )}
    </figure>
  )
}

function Layer({
  ok,
  src,
  label,
  after,
  onError,
}: {
  ok: boolean
  src: string
  label: string
  after?: boolean
  onError: () => void
}) {
  if (!ok) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center ${
          after ? "bg-accent" : "bg-popover"
        }`}
      >
        <span className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          {label} photo
        </span>
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static asset, no optimizer needed
    <img src={src} alt={label} onError={onError} className="h-full w-full object-cover" />
  )
}
