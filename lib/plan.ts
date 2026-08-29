// Floor plan export helpers (phase 11). Server-only (sharp/pdf-lib). Address
// label and disclaimer are composited here deterministically — never prompted,
// AI-rendered fine print garbles (DECISIONS.md).
import sharp from "sharp"
import { PDFDocument } from "pdf-lib"

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export type ComposedPlan = { png: Buffer; width: number; height: number }

/**
 * Normalize a plan output to PNG, extending the canvas with a white address
 * band on top and/or a disclaimer band at the bottom.
 */
export async function composePlanPng(
  buf: Buffer,
  opts: { address?: string; disclaimer?: string } = {}
): Promise<ComposedPlan> {
  const meta = await sharp(buf).metadata()
  const w = meta.width ?? 1024
  const h = meta.height ?? 1024
  const address = opts.address?.trim()
  const disclaimer = opts.disclaimer?.trim()
  const png = await sharp(buf).png().toBuffer()
  if (!address && !disclaimer) return { png, width: w, height: h }

  const top = address ? Math.max(56, Math.round(h * 0.07)) : 0
  const bottom = disclaimer ? Math.max(44, Math.round(h * 0.055)) : 0
  const totalH = h + top + bottom
  // ponytail: single-line text, font scaled to fit width; wrap when a real
  // disclaimer ever overflows
  const addressSize = address
    ? Math.min(Math.round(top * 0.45), Math.floor((w * 0.94) / (address.length * 0.6)))
    : 0
  const disclaimerSize = disclaimer
    ? Math.min(Math.round(bottom * 0.38), Math.floor((w * 0.96) / (disclaimer.length * 0.52)))
    : 0
  const svg = Buffer.from(
    `<svg width="${w}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
       ${address ? `<text x="${w / 2}" y="${Math.round(top * 0.62)}" font-family="Helvetica, Arial, sans-serif" font-size="${addressSize}" font-weight="bold" fill="#1a1a1a" text-anchor="middle">${esc(address)}</text>` : ""}
       ${disclaimer ? `<text x="${w / 2}" y="${h + top + Math.round(bottom * 0.6)}" font-family="Helvetica, Arial, sans-serif" font-size="${disclaimerSize}" fill="#555555" text-anchor="middle">${esc(disclaimer)}</text>` : ""}
     </svg>`
  )
  const composed = await sharp({
    create: { width: w, height: totalH, channels: 3, background: "#ffffff" },
  })
    .composite([{ input: png, top, left: 0 }, { input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer()
  return { png: composed, width: w, height: totalH }
}

// SVG export wraps the raster plan as an embedded image — true vectorization
// is out of scope (DECISIONS.md); the file still scales and opens everywhere.
export function planSvg(plan: ComposedPlan): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${plan.width}" height="${plan.height}" viewBox="0 0 ${plan.width} ${plan.height}"><image width="${plan.width}" height="${plan.height}" xlink:href="data:image/png;base64,${plan.png.toString("base64")}"/></svg>`
}

// PDF export: letter landscape, plan fit-scaled and centered.
export async function planPdf(plan: ComposedPlan): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const pageW = 792
  const pageH = 612
  const page = doc.addPage([pageW, pageH])
  const img = await doc.embedPng(plan.png)
  const margin = 24
  const scale = Math.min((pageW - 2 * margin) / plan.width, (pageH - 2 * margin) / plan.height)
  const drawW = plan.width * scale
  const drawH = plan.height * scale
  page.drawImage(img, {
    x: (pageW - drawW) / 2,
    y: (pageH - drawH) / 2,
    width: drawW,
    height: drawH,
  })
  return doc.save()
}
