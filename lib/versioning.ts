export const MIN_VARIATIONS = 2
export const MAX_VARIATIONS = 4
export const MAX_VERSION_LABEL_LENGTH = 80
export const MAX_VARIATION_INSTRUCTIONS_LENGTH = 1000

export type VariationInput = {
  requestId: string
  count: number
  instructions: string
  labels: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizeVersionLabel(value: unknown, allowEmpty = false): string | null {
  if (typeof value !== "string") throw new Error("Version name must be text.")
  const label = value.replace(/\s+/g, " ").trim()
  if (!label && allowEmpty) return null
  if (!label) throw new Error("Give this version a name.")
  if (label.length > MAX_VERSION_LABEL_LENGTH) {
    throw new Error(`Version names can be at most ${MAX_VERSION_LABEL_LENGTH} characters.`)
  }
  return label
}

export function validateVariationInput(value: unknown): VariationInput {
  if (!value || typeof value !== "object") throw new Error("Variation details are required.")
  const input = value as Record<string, unknown>
  if (typeof input.requestId !== "string" || !UUID.test(input.requestId)) {
    throw new Error("A valid retry identity is required.")
  }
  const count = Number(input.count)
  if (!Number.isInteger(count) || count < MIN_VARIATIONS || count > MAX_VARIATIONS) {
    throw new Error(`Choose ${MIN_VARIATIONS}–${MAX_VARIATIONS} variations.`)
  }
  const instructions = typeof input.instructions === "string"
    ? input.instructions.replace(/\s+/g, " ").trim()
    : ""
  if (instructions.length < 2 || instructions.length > MAX_VARIATION_INSTRUCTIONS_LENGTH) {
    throw new Error(`Variation direction must be 2–${MAX_VARIATION_INSTRUCTIONS_LENGTH} characters.`)
  }
  if (!Array.isArray(input.labels) || input.labels.length !== count) {
    throw new Error("Name every requested variation.")
  }
  const labels = input.labels.map((label) => normalizeVersionLabel(label)!)
  if (new Set(labels.map((label) => label.toLocaleLowerCase())).size !== labels.length) {
    throw new Error("Each variation needs a different name.")
  }
  return { requestId: input.requestId, count, instructions, labels }
}

export function variationGenerationCostCents(unitCostCents: number, count: number): number {
  if (!Number.isInteger(count) || count < MIN_VARIATIONS || count > MAX_VARIATIONS) {
    throw new Error("Unsupported variation count.")
  }
  if (!Number.isFinite(unitCostCents) || unitCostCents < 0) throw new Error("Invalid generation cost.")
  return unitCostCents * count
}

export function formatGenerationCost(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(cents / 100)
}

export function automaticVersionLabel(input: {
  versionLabel?: string | null
  parentVersionId: string | null
  versionNumber: number
  variationIndex?: number | null
}): string {
  if (input.versionLabel) return input.versionLabel
  if (input.variationIndex) return `Variation ${input.variationIndex}`
  if (!input.parentVersionId && input.versionNumber === 1) return "Original edit"
  return `Revision ${Math.max(1, input.versionNumber - 1)}`
}

export function branchContext(
  version: { parentVersionId?: string | null; parent_version_id?: string | null },
  versions: Array<{ id: string; displayLabel: string }>
): string {
  const parentVersionId = version.parentVersionId ?? version.parent_version_id ?? null
  if (!parentVersionId) return "First result in this branch"
  const parent = versions.find((candidate) => candidate.id === parentVersionId)
  return parent ? `Branched from ${parent.displayLabel}` : "Branched from an earlier saved version"
}
