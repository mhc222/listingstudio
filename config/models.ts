// Per-model rates and fal endpoints. Data, not code — edit rates here, never hardcode.

export type ProviderKey = "qwen" | "gemini" | "kontext" | "local"

export const MODELS: Record<
  ProviderKey,
  { falId: string | null; label: string; costCents: number }
> = {
  // DEFAULT
  qwen: { falId: "fal-ai/qwen-image-edit", label: "Qwen Image Edit", costCents: 2.1 },
  // QUALITY_FALLBACK (one click, or "geometry drifted" rework)
  gemini: {
    falId: "fal-ai/gemini-25-flash-image/edit",
    label: "Gemini 2.5 Flash Image",
    costCents: 3.9,
  },
  // CHAINED_EDITS (3+ chained edits)
  kontext: { falId: "fal-ai/flux-pro/kontext", label: "Flux Kontext Pro", costCents: 4 },
  // Stub — ComfyUI-format endpoint, wiring is manual (env LOCAL_IMAGING_BASE_URL)
  local: { falId: null, label: "Local endpoint", costCents: 0 },
}

export function pickProvider(chainLength: number, hasRefs = false): ProviderKey {
  // gemini is the only endpoint accepting multiple input images, so reference
  // images force it (DECISIONS.md)
  if (hasRefs) return "gemini"
  return chainLength >= 3 ? "kontext" : "qwen"
}

// Cost simulation assumption (phase 10)
export const AVG_GENERATIONS_PER_FILE_GROUP = 2.5
