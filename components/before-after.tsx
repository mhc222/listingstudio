"use client"

import { useState } from "react"

// Clip-path before/after slider (phase 10): a range input over stacked images.
// Left of the divider shows the original, right shows the edited output.
export function BeforeAfter({ beforeUrl, afterUrl }: { beforeUrl: string | null; afterUrl: string }) {
  const [pos, setPos] = useState(50)
  if (!beforeUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
    return <img src={afterUrl} alt="" className="develop-in w-full rounded-md" />
  }
  return (
    <div className="relative w-full select-none overflow-hidden rounded-md">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that */}
      <img src={beforeUrl} alt="Before" className="block w-full" />
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that */}
      <img
        src={afterUrl}
        alt="After"
        className="develop-in absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
      />
      {/* Divider doubles as a grab affordance: the crop-mark bracket from the
          identity, so the slider reads as part of the brand rather than a
          generic handle. */}
      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/90 shadow"
        style={{ left: `${pos}%` }}
      >
        <span className="absolute top-1/2 left-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow-md">
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 6L4 12l5 6M15 6l5 6-5 6"
              fill="none"
              stroke="#14181B"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
      <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
        Before
      </span>
      <span className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
        After
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Before/after divider"
        className="absolute inset-x-0 bottom-2 mx-auto w-11/12 cursor-ew-resize accent-white"
      />
    </div>
  )
}
