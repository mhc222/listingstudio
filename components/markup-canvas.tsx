"use client"

// Markup-to-edit (phase 23): drag-draw marks over the selected photo — blue
// circle = remove the marked item, red rectangle = replace it. "Attach markup"
// flattens the stage at original resolution, uploads it via /api/markup, and
// hands the storage path + mark counts back to the job composer. The clean
// original photo is never touched.

import { useEffect, useRef, useState } from "react"
import { Stage, Layer, Image as KImage, Ellipse, Rect } from "react-konva"
import type Konva from "konva"
import { Button } from "@/components/ui/button"

type Tool = "remove" | "replace"
type Mark = { t: Tool; x: number; y: number; w: number; h: number }

// mark colors proven in the gate experiment (scripts/test-markup.mjs)
const MARK_COLORS: Record<Tool, string> = { remove: "#0033FF", replace: "#FF0000" }
const DISPLAY_W = 880
const MIN_MARK_PX = 8

function norm(m: Mark): Mark {
  return {
    t: m.t,
    x: Math.min(m.x, m.x + m.w),
    y: Math.min(m.y, m.y + m.h),
    w: Math.abs(m.w),
    h: Math.abs(m.h),
  }
}

export function MarkupCanvas({
  src,
  onAttach,
}: {
  src: string
  onAttach: (markup: {
    markup_path: string
    remove_count: number
    replace_count: number
  }) => void
}) {
  const stageRef = useRef<Konva.Stage>(null)
  const draftRef = useRef<Mark | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>("remove")
  const [marks, setMarks] = useState<Mark[]>([])
  const [draft, setDraft] = useState<Mark | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    setMarks([])
    setDraft(null)
    setImg(null)
    const el = new window.Image()
    // Supabase storage serves CORS *; anonymous keeps the canvas exportable
    el.crossOrigin = "anonymous"
    el.onload = () => setImg(el)
    el.onerror = () => setMessage("Couldn't load the photo.")
    el.src = src
  }, [src])

  if (!img) return <p className="text-sm text-muted-foreground">{message || "Loading photo…"}</p>

  const scale = Math.min(1, DISPLAY_W / img.naturalWidth)
  const stageW = Math.round(img.naturalWidth * scale)
  const stageH = Math.round(img.naturalHeight * scale)

  // the ref is the source of truth for the in-progress drag: mousemove state
  // updates flush at continuous-event priority, so the mouseup closure can
  // still see a stale draft — and committing inside a setDraft updater is a
  // side effect StrictMode double-invokes (duplicated marks)
  function pointerDown() {
    const pos = stageRef.current?.getPointerPosition()
    if (!pos || busy) return
    const d = { t: tool, x: pos.x, y: pos.y, w: 0, h: 0 }
    draftRef.current = d
    setDraft(d)
  }

  function pointerMove() {
    const pos = stageRef.current?.getPointerPosition()
    const d = draftRef.current
    if (!pos || !d) return
    const next = { ...d, w: pos.x - d.x, h: pos.y - d.y }
    draftRef.current = next
    setDraft(next)
  }

  function pointerUp() {
    const d = draftRef.current
    draftRef.current = null
    if (d && Math.abs(d.w) >= MIN_MARK_PX && Math.abs(d.h) >= MIN_MARK_PX) {
      setMarks((m) => [...m, norm(d)])
    }
    setDraft(null)
  }

  async function attach() {
    if (!marks.length || busy) return
    setBusy(true)
    setMessage("Attaching markup…")
    try {
      // flatten at the photo's original resolution
      const uri = stageRef.current!.toDataURL({ pixelRatio: 1 / scale, mimeType: "image/png" })
      const blob = await (await fetch(uri)).blob()
      const form = new FormData()
      form.append("file", new File([blob], "markup.png", { type: "image/png" }))
      const res = await fetch("/api/markup", { method: "POST", body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.path) throw new Error(data?.error ?? `upload failed (${res.status})`)
      onAttach({
        markup_path: data.path,
        remove_count: marks.filter((m) => m.t === "remove").length,
        replace_count: marks.filter((m) => m.t === "replace").length,
      })
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Attach failed — try again.")
      setBusy(false)
    }
  }

  const toolButton = (t: Tool, label: string) => (
    <Button size="sm" variant={tool === t ? "default" : "outline"} onClick={() => setTool(t)}>
      {label}
    </Button>
  )

  const renderMark = (m: Mark, i: number | string) =>
    m.t === "remove" ? (
      <Ellipse
        key={i}
        x={m.x + m.w / 2}
        y={m.y + m.h / 2}
        radiusX={m.w / 2}
        radiusY={m.h / 2}
        stroke={MARK_COLORS.remove}
        strokeWidth={5}
      />
    ) : (
      <Rect key={i} x={m.x} y={m.y} width={m.w} height={m.h} stroke={MARK_COLORS.replace} strokeWidth={5} />
    )

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {toolButton("remove", "Remove (blue circle)")}
        {toolButton("replace", "Replace (red rectangle)")}
        <Button
          size="sm"
          variant="outline"
          disabled={!marks.length || busy}
          onClick={() => setMarks((m) => m.slice(0, -1))}
        >
          Undo
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!marks.length || busy}
          onClick={() => setMarks([])}
        >
          Clear
        </Button>
        <Button size="sm" disabled={!marks.length || busy} onClick={attach}>
          {busy ? "Attaching…" : "Attach markup"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Drag to draw. Circle what to remove; box what to replace, then describe the replacement in
        the comment field below.
      </p>
      <div className="max-w-full overflow-x-auto rounded-md border">
        <Stage
          ref={stageRef}
          width={stageW}
          height={stageH}
          onMouseDown={pointerDown}
          onMouseMove={pointerMove}
          onMouseUp={pointerUp}
          onTouchStart={pointerDown}
          onTouchMove={pointerMove}
          onTouchEnd={pointerUp}
          style={{ cursor: "crosshair", touchAction: "none" }}
        >
          <Layer>
            <KImage image={img} width={stageW} height={stageH} />
            {marks.map((m, i) => renderMark(m, i))}
            {draft && renderMark(norm(draft), "draft")}
          </Layer>
        </Stage>
      </div>
      {message && !busy && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}
