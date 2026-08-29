"use client"

import { useState } from "react"
import { TourViewer, type TourScene } from "@/components/tour-viewer"

export function TourView({ title, scenes }: { title: string; scenes: TourScene[] }) {
  const [activeId, setActiveId] = useState(scenes[0]?.id ?? "")
  if (!activeId) return null

  return (
    <div className="relative h-full w-full">
      <TourViewer scenes={scenes} activeSceneId={activeId} onSceneChange={setActiveId} />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <span className="rounded-md bg-black/60 px-3 py-1.5 text-sm font-medium text-white">
          {title}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-wrap justify-center gap-1.5 p-3">
        {scenes.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveId(s.id)}
            className={`rounded-full px-3 py-1.5 text-sm text-white ${
              s.id === activeId ? "bg-blue-600" : "bg-black/60 hover:bg-black/80"
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  )
}
