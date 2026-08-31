"use client"

import { useState } from "react"

// Clip-path before/after slider (phase 10): a range input over stacked images.
// Left of the divider shows the original, right shows the edited output.
export function BeforeAfter({ beforeUrl, afterUrl }: { beforeUrl: string | null; afterUrl: string }) {
  const [pos, setPos] = useState(50)
  if (!beforeUrl) {
    return (
      <div className="flex w-full justify-center overflow-hidden bg-[#241f1a]">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that */}
        <img
          src={afterUrl}
          alt="Edited listing photo"
          className="develop-in block h-auto max-h-[calc(100dvh-10rem)] max-w-full object-contain"
        />
      </div>
    )
  }
  return (
    <div className="flex w-full max-w-full justify-center overflow-hidden bg-[#241f1a]">
      <div className="relative inline-block max-w-full touch-none select-none overflow-hidden">
        {/* The original controls the frame's intrinsic aspect ratio. Both
            images remain fully contained, so the review never crops evidence
            or pushes the action rail beyond the viewport. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that */}
        <img
          src={beforeUrl}
          alt="Original listing photo"
          className="block h-auto max-h-[calc(100dvh-10rem)] max-w-full object-contain"
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that */}
        <img
          src={afterUrl}
          alt="Edited listing photo"
          className="develop-in absolute inset-0 h-full w-full object-contain"
          style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
        />
        {/* Divider doubles as a grab affordance: the crop-mark bracket from the
            identity, so the slider reads as part of the brand rather than a
            generic handle. */}
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/90 shadow"
          style={{ left: `${pos}%` }}
        >
          <span className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow-md">
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
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Before
        </span>
        <span className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
          After
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label="Before and after comparison"
          aria-valuetext={`${pos}% original, ${100 - pos}% edited`}
          className="peer absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
        <span className="pointer-events-none absolute inset-1 opacity-0 ring-2 ring-white ring-offset-2 ring-offset-[#241f1a] transition-opacity peer-focus-visible:opacity-100" />
      </div>
    </div>
  )
}
