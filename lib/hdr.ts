import sharp from "sharp"

// HDR_MERGE (phase 14): exposure fusion in code, not AI (CLAUDE.md).
// ponytail: single-scale well-exposedness weighting (Mertens-lite — no
// contrast/saturation terms, no pyramid blending); upgrade to multiband
// blending if halos on high-contrast window edges annoy.
export async function fuseExposures(inputs: Buffer[]): Promise<Buffer> {
  if (inputs.length < 3 || inputs.length > 9) {
    throw new Error("HDR merge needs 3-9 bracketed exposures")
  }
  const metas = await Promise.all(inputs.map((b) => sharp(b).metadata()))
  const width = Math.min(...metas.map((m) => m.width ?? 0))
  const height = Math.min(...metas.map((m) => m.height ?? 0))
  if (!width || !height) throw new Error("could not read bracket dimensions")
  // brackets from a tripod share dimensions; fit:fill absorbs off-by-a-few
  // pixel differences from format conversion
  const raws = await Promise.all(
    inputs.map((b) =>
      sharp(b).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer()
    )
  )

  const n = width * height * 3
  const acc = new Float64Array(n)
  const wsum = new Float64Array(width * height)
  for (const raw of raws) {
    for (let p = 0, i = 0; i < n; p++, i += 3) {
      const r = raw[i]
      const g = raw[i + 1]
      const b = raw[i + 2]
      // well-exposedness: gaussian around mid-gray luminance (sigma 0.2)
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      const d = lum - 0.5
      const w = Math.exp(-(d * d) / 0.08) + 1e-6
      wsum[p] += w
      acc[i] += w * r
      acc[i + 1] += w * g
      acc[i + 2] += w * b
    }
  }
  const out = Buffer.allocUnsafe(n)
  for (let p = 0, i = 0; i < n; p++, i += 3) {
    const w = wsum[p]
    out[i] = Math.round(acc[i] / w)
    out[i + 1] = Math.round(acc[i + 1] / w)
    out[i + 2] = Math.round(acc[i + 2] / w)
  }
  return sharp(out, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer()
}
