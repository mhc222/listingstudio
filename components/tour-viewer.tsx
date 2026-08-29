"use client"

// Marzipano pano viewer shared by the tour builder and the public share page.
// Marzipano touches window at import time, so it's loaded inside an effect.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"

export type Hotspot = { yaw: number; pitch: number; target: string; label: string }

export type TourScene = {
  id: string
  name: string
  url: string | null
  width: number
  initial_yaw: number
  hotspots: Hotspot[]
}

export type TourViewerHandle = {
  /** Current camera yaw in radians (for "set start view"). */
  getYaw: () => number | null
}

type Props = {
  scenes: TourScene[]
  activeSceneId: string
  onSceneChange?: (id: string) => void
  /** When set, a stationary click on the pano reports its yaw/pitch. */
  onPlaceHotspot?: (yaw: number, pitch: number) => void
}

export const TourViewer = forwardRef<TourViewerHandle, Props>(function TourViewer(
  { scenes, activeSceneId, onSceneChange, onPlaceHotspot },
  ref
) {
  const elRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- marzipano ships no types
  const viewerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scenesRef = useRef<Record<string, any>>({})
  const activeRef = useRef(activeSceneId)
  const onSceneChangeRef = useRef(onSceneChange)
  const onPlaceHotspotRef = useRef(onPlaceHotspot)
  onSceneChangeRef.current = onSceneChange
  onPlaceHotspotRef.current = onPlaceHotspot
  activeRef.current = activeSceneId

  useImperativeHandle(ref, () => ({
    getYaw: () => {
      const s = scenesRef.current[activeRef.current]
      return s ? (s.view().yaw() as number) : null
    },
  }))

  const scenesKey = JSON.stringify(
    scenes.map((s) => [s.id, s.url, s.width, s.initial_yaw, s.hotspots])
  )

  // Build (and rebuild on any scene change) the viewer + all scenes.
  useEffect(() => {
    const el = elRef.current
    if (!el || scenes.length === 0) return
    let destroyed = false

    ;(async () => {
      const Marzipano = (await import("marzipano")).default
      if (destroyed) return

      const viewer = new Marzipano.Viewer(el)
      viewerRef.current = viewer
      const byId = new Map(scenes.map((s) => [s.id, s]))

      for (const s of scenes) {
        if (!s.url) continue
        const source = Marzipano.ImageUrlSource.fromString(s.url)
        const geometry = new Marzipano.EquirectGeometry([{ width: s.width }])
        const limiter = Marzipano.RectilinearView.limit.traditional(
          s.width,
          (100 * Math.PI) / 180
        )
        const view = new Marzipano.RectilinearView(
          { yaw: s.initial_yaw, fov: Math.PI / 2 },
          limiter
        )
        const scene = viewer.createScene({ source, geometry, view })
        scenesRef.current[s.id] = scene

        for (const h of s.hotspots) {
          if (!byId.has(h.target)) continue
          const btn = document.createElement("button")
          btn.type = "button"
          btn.textContent = h.label || byId.get(h.target)!.name
          btn.className =
            "cursor-pointer whitespace-nowrap rounded-full bg-black/60 px-3 py-1.5 text-sm text-white shadow hover:bg-black/80"
          btn.addEventListener("click", (e) => {
            e.stopPropagation()
            onSceneChangeRef.current?.(h.target)
          })
          scene.hotspotContainer().createHotspot(btn, { yaw: h.yaw, pitch: h.pitch })
        }
      }

      scenesRef.current[activeRef.current]?.switchTo()
    })()

    // Distinguish a stationary click (place hotspot) from a pan drag.
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e: PointerEvent) => {
      if (!down || !onPlaceHotspotRef.current) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 5) return
      const scene = scenesRef.current[activeRef.current]
      if (!scene) return
      const rect = el.getBoundingClientRect()
      const coords = scene
        .view()
        .screenToCoordinates({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      onPlaceHotspotRef.current(coords.yaw, coords.pitch)
    }
    el.addEventListener("pointerdown", onDown)
    el.addEventListener("pointerup", onUp)

    return () => {
      destroyed = true
      el.removeEventListener("pointerdown", onDown)
      el.removeEventListener("pointerup", onUp)
      scenesRef.current = {}
      viewerRef.current?.destroy()
      viewerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scenesKey covers scenes
  }, [scenesKey])

  useEffect(() => {
    scenesRef.current[activeSceneId]?.switchTo()
  }, [activeSceneId])

  return <div ref={elRef} className="h-full w-full" />
})
