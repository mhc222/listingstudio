// Download-time delivery helpers (phase 10): size/resolution variants and the
// "Virtually Staged" compliance watermark. Shared by the single-file download
// route and the per-listing zip. Server-only (sharp).
import sharp from "sharp"

const CAPS_BYTES: Record<string, number> = {
  under_10mb: 10 * 1024 * 1024,
  under_5mb: 5 * 1024 * 1024,
}

// "full" = full-res edited output untouched; "original" (the source photo) is
// handled by the routes since it never goes through sharp.
export const VARIANTS = ["full", "web1920", "under_10mb", "under_5mb"] as const
export type Variant = (typeof VARIANTS)[number]

// fg.size_preset ("original" means full-res edited) -> download variant
export function presetToVariant(sizePreset: string): Variant {
  return sizePreset === "under_10mb" || sizePreset === "under_5mb" ? sizePreset : "full"
}

// Watermark defaults ON for staging/renovation chains (CLAUDE.md compliance)
export function isStaged(chain: { edit_type: string }[]): boolean {
  return chain.some((s) => ["VIRTUAL_STAGING", "VIRTUAL_RENOVATION"].includes(s.edit_type))
}

// Corner disclosure pill, bottom-right with a 16px margin baked into the SVG.
// Applied BEFORE the quality ladder so the ladder compresses the final pixels.
export async function applyWatermark(buf: Buffer): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg width="236" height="60" xmlns="http://www.w3.org/2000/svg">
       <rect x="0" y="0" width="220" height="44" rx="22" fill="black" fill-opacity="0.55"/>
       <text x="110" y="29" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="1.5">VIRTUALLY STAGED</text>
     </svg>`
  )
  return sharp(buf).composite([{ input: svg, gravity: "southeast" }]).jpeg({ quality: 92 }).toBuffer()
}

export async function applyVariant(buf: Buffer, variant: Variant): Promise<Buffer> {
  if (variant === "web1920") {
    return sharp(buf)
      .resize({ width: 1920, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
  }
  const cap = CAPS_BYTES[variant]
  if (cap && buf.length > cap) {
    // ponytail: descending-quality ladder, first fit wins; enough for MLS caps
    for (const quality of [90, 80, 70, 60, 50, 40]) {
      const candidate = await sharp(buf).jpeg({ quality }).toBuffer()
      if (candidate.length <= cap) return candidate
    }
  }
  return buf
}
