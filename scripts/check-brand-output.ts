// Phase 18 DoD pixel check: watermark pill + plan bands.
import sharp from "sharp"
import { applyWatermark } from "../lib/deliver"
import { composePlanPng } from "../lib/plan"
import assert from "node:assert"

async function main() {
  // --- watermark: mid-gray photo, inspect bottom-right corner region
  const photo = await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: "#909090" },
  })
    .jpeg()
    .toBuffer()
  const marked = await applyWatermark(photo)
  const region = await sharp(marked)
    .extract({ left: 1600 - 262, top: 1000 - 60, width: 262, height: 60 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  let dark = 0
  let brass = 0
  const d = region.data
  for (let i = 0; i < d.length; i += 3) {
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]]
    if (r < 60 && g < 60 && b < 60) dark++
    // brass #A57C3F ≈ (165,124,63): warm, r > g > b with a real red-blue spread
    if (r > 110 && r - b > 45 && r >= g && g > b) brass++
  }
  console.log("watermark region: dark scrim px =", dark, "brass px =", brass)
  assert(dark > 2000, "expected a dark scrim in the corner")
  assert(brass > 100, "expected brass mark/text pixels")

  // untouched pixel far from the corner stays gray
  const far = await sharp(marked).extract({ left: 10, top: 10, width: 4, height: 4 }).raw().toBuffer()
  assert(Math.abs(far[0] - 0x90) < 12, "photo body should be untouched")

  // --- plan bands: white plan, address + disclaimer, bands must be pure grayscale
  const plan = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#f0f0f0" },
  })
    .png()
    .toBuffer()
  const composed = await composePlanPng(plan, {
    address: "14 Aster Grove",
    disclaimer: "Approximate dimensions. Not to scale. For illustration only.",
  })
  const topBandH = Math.max(56, Math.round(600 * 0.07))
  const band = await sharp(composed.png)
    .extract({ left: 0, top: 0, width: 800, height: topBandH })
    .raw()
    .toBuffer()
  // subpixel text antialiasing leaves red/cyan glyph fringes, so "any colored
  // pixel" is the wrong test — check for the actual brand teals instead
  const TEALS: [number, number, number][] = [
    [0x3f, 0xbf, 0xb9], // signal teal
    [0x7f, 0xd9, 0xd4], // teal light
    [0x14, 0x7f, 0x7a], // light-mode teal
  ]
  let white = 0
  let black = 0
  let brandTeal = 0
  for (let i = 0; i < band.length; i += 3) {
    const [r, g, b] = [band[i], band[i + 1], band[i + 2]]
    if (r > 240 && g > 240 && b > 240) white++
    if (r < 60 && g < 60 && b < 60) black++
    if (TEALS.some(([tr, tg, tb]) => Math.abs(r - tr) + Math.abs(g - tg) + Math.abs(b - tb) < 90))
      brandTeal++
  }
  console.log("plan top band: white px =", white, "black text px =", black, "brand-teal px =", brandTeal)
  assert(white > band.length / 3 / 2, "band background should be white")
  assert(black > 200, "address text should render in black")
  // a handful of AA fringe midtones graze the teal region of RGB space; any
  // actually-drawn teal element (the watermark mark is ~220 px at 18px) fails
  assert(brandTeal < 50, "band must stay pure black on white — never teal")
  console.log("PIXEL CHECKS PASS")
}

main()
