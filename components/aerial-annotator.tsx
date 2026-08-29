"use client"

// AERIAL annotation (phase 14): manual Konva drawing over a drone shot —
// LOT_HIGHLIGHT polygons, DROP_PIN markers, boundary lines — flattened PNG
// export at original resolution. No AI involved (CLAUDE.md).

import { useEffect, useRef, useState } from "react"
import { Stage, Layer, Image as KImage, Line, Circle, Label, Tag, Text } from "react-konva"
import type Konva from "konva"
import { Button } from "@/components/ui/button"

type Tool = "lot" | "line" | "pin"

// Undo = pop the last op; all shapes derive from the ops list.
type Op =
  | { t: "lot-point"; x: number; y: number }
  | { t: "lot-close" }
  | { t: "line-point"; x: number; y: number }
  | { t: "line-end" }
  | { t: "pin"; x: number; y: number; label: string }

type Shapes = {
  lots: number[][]
  openLot: number[]
  lines: number[][]
  openLine: number[]
  pins: { x: number; y: number; label: string }[]
}

function derive(ops: Op[]): Shapes {
  const s: Shapes = { lots: [], openLot: [], lines: [], openLine: [], pins: [] }
  for (const op of ops) {
    if (op.t === "lot-point") s.openLot.push(op.x, op.y)
    else if (op.t === "lot-close") {
      if (s.openLot.length >= 6) s.lots.push(s.openLot)
      s.openLot = []
    } else if (op.t === "line-point") s.openLine.push(op.x, op.y)
    else if (op.t === "line-end") {
      if (s.openLine.length >= 4) s.lines.push(s.openLine)
      s.openLine = []
    } else s.pins.push({ x: op.x, y: op.y, label: op.label })
  }
  return s
}

const DISPLAY_W = 880

export function AerialAnnotator({
  src,
  onSave,
}: {
  src: string
  // receives the flattened full-resolution PNG
  onSave?: (blob: Blob) => Promise<void>
}) {
  const stageRef = useRef<Konva.Stage>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>("lot")
  const [ops, setOps] = useState<Op[]>([])
  const [pinLabel, setPinLabel] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setOps([])
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
  const shapes = derive(ops)
  const drawing = shapes.openLot.length > 0 || shapes.openLine.length > 0

  function stageClick() {
    const pos = stageRef.current?.getPointerPosition()
    if (!pos) return
    if (tool === "lot") setOps((o) => [...o, { t: "lot-point", x: pos.x, y: pos.y }])
    else if (tool === "line") setOps((o) => [...o, { t: "line-point", x: pos.x, y: pos.y }])
    else setOps((o) => [...o, { t: "pin", x: pos.x, y: pos.y, label: pinLabel.trim() }])
  }

  function finishShape() {
    setOps((o) => [...o, tool === "line" ? { t: "line-end" } : { t: "lot-close" }])
  }

  function switchTool(next: Tool) {
    // close any in-progress shape so tools never bleed into each other
    if (drawing) finishShape()
    setTool(next)
  }

  function exportPng(): Promise<Blob> {
    const uri = stageRef.current!.toDataURL({ pixelRatio: 1 / scale, mimeType: "image/png" })
    return fetch(uri).then((r) => r.blob())
  }

  async function download() {
    try {
      const blob = await exportPng()
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = "aerial-annotated.png"
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      setMessage("Export failed — the photo URL may have expired; reload the page.")
    }
  }

  async function save() {
    if (!onSave) return
    setBusy(true)
    setMessage("Saving to listing…")
    try {
      await onSave(await exportPng())
      setMessage("Saved as a listing photo.")
    } catch {
      setMessage("Save failed — try again.")
    } finally {
      setBusy(false)
    }
  }

  const toolButton = (t: Tool, label: string) => (
    <Button size="sm" variant={tool === t ? "default" : "outline"} onClick={() => switchTool(t)}>
      {label}
    </Button>
  )

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {toolButton("lot", "Lot highlight")}
        {toolButton("line", "Boundary line")}
        {toolButton("pin", "Drop pin")}
        {tool === "pin" && (
          <input
            value={pinLabel}
            onChange={(e) => setPinLabel(e.target.value)}
            placeholder="Pin label (optional)"
            className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
          />
        )}
        {drawing && (
          <Button size="sm" variant="secondary" onClick={finishShape}>
            Finish shape
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!ops.length}
          onClick={() => setOps((o) => o.slice(0, -1))}
        >
          Undo
        </Button>
        <Button size="sm" variant="outline" disabled={!ops.length} onClick={() => setOps([])}>
          Clear
        </Button>
        <Button size="sm" disabled={busy} onClick={download}>
          Export PNG
        </Button>
        {onSave && (
          <Button size="sm" variant="outline" disabled={busy} onClick={save}>
            Save to listing
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {tool === "pin"
          ? "Click to drop a pin."
          : "Click to add points; double-click or Finish shape to close."}
      </p>
      <div className="max-w-full overflow-x-auto rounded-md border">
        <Stage
          ref={stageRef}
          width={stageW}
          height={stageH}
          onClick={stageClick}
          onDblClick={finishShape}
          style={{ cursor: "crosshair" }}
        >
          <Layer>
            <KImage image={img} width={stageW} height={stageH} />
            {shapes.lots.map((pts, i) => (
              <Line
                key={`lot-${i}`}
                points={pts}
                closed
                fill="rgba(250, 204, 21, 0.35)"
                stroke="#facc15"
                strokeWidth={3}
              />
            ))}
            {shapes.openLot.length >= 2 && (
              <Line points={shapes.openLot} stroke="#facc15" strokeWidth={3} dash={[6, 4]} />
            )}
            {shapes.lines.map((pts, i) => (
              <Line
                key={`line-${i}`}
                points={pts}
                stroke="#ef4444"
                strokeWidth={3}
                dash={[10, 6]}
              />
            ))}
            {shapes.openLine.length >= 2 && (
              <Line points={shapes.openLine} stroke="#ef4444" strokeWidth={2} dash={[4, 4]} />
            )}
            {shapes.pins.map((p, i) => (
              <Circle
                key={`pin-${i}`}
                x={p.x}
                y={p.y}
                radius={7}
                fill="#ef4444"
                stroke="#ffffff"
                strokeWidth={2}
              />
            ))}
            {shapes.pins
              .filter((p) => p.label)
              .map((p, i) => (
                <Label key={`pinlabel-${i}`} x={p.x + 10} y={p.y - 10}>
                  <Tag fill="rgba(0,0,0,0.7)" cornerRadius={3} />
                  <Text text={p.label} fill="#ffffff" padding={4} fontSize={13} />
                </Label>
              ))}
          </Layer>
        </Stage>
      </div>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}
