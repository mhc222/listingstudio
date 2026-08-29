"use client"

import { useState } from "react"

// Clip-path before/after slider (phase 10): a range input over stacked images.
// Left of the divider shows the original, right shows the edited output.
export function BeforeAfter({ beforeUrl, afterUrl }: { beforeUrl: string | null; afterUrl: string }) {
  const [pos, setPos] = useState(50)
  if (!beforeUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that
    return <img src={afterUrl} alt="" className="w-full rounded-md" />
  }
  return (
    <div className="relative w-full select-none overflow-hidden rounded-md">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that */}
      <img src={beforeUrl} alt="Before" className="block w-full" />
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; next/image caching fights that */}
      <img
        src={afterUrl}
        alt="After"
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/90 shadow"
        style={{ left: `${pos}%` }}
      />
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
