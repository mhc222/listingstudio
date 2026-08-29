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
// Darkroom identity (phase 18): mark + compliance text in teal-light on an
// 82%-opacity dark scrim so it survives any photograph beneath it. The mark
// drops the floor rule at this size — three elements is one too many under
// 12px (spec §06). Applied BEFORE the quality ladder so the ladder compresses
// the final pixels.
export async function applyWatermark(buf: Buffer): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg width="262" height="60" xmlns="http://www.w3.org/2000/svg">
       <rect x="0" y="0" width="246" height="44" rx="22" fill="#0B0E10" fill-opacity="0.82"/>
       <svg x="17" y="13" width="18" height="18" viewBox="0 0 48 48">
         <path d="M7 15V7h8M41 15V7h-8M7 25v8h8M41 25v8h-8" fill="none" stroke="#7FD9D4" stroke-width="4.4"/>
         <rect x="16" y="15" width="16" height="18" fill="#7FD9D4"/>
       </svg>
       <text x="43" y="28" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="13" font-weight="bold" fill="#7FD9D4" letter-spacing="2">VIRTUALLY STAGED</text>
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
