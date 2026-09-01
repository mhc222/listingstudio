export type ProofingStatus =
  | "unreviewed"
  | "approved"
  | "needs_changes"
  | "processing"
  | "needs_attention"

export type ProofingQaStatus = "original" | "ready" | "review"

export type ProofingVersionState = {
  id: string
  versionNumber: number
  createdAt: string
  reviewState: "unreviewed" | "needs_changes" | "approved"
  qaNeedsReview: boolean
}

export type ProofingStateInput = {
  finalExists: boolean
  finalOutputVersionId: string | null
  versions: ProofingVersionState[]
  groupStatuses: string[]
}

export const ORIGINAL_SELECTION = "original"

export function sortedProofingVersions<T extends { versionNumber: number; createdAt: string }>(
  versions: T[]
): T[] {
  return [...versions].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.versionNumber - a.versionNumber
  )
}

export function initialProofingSelection(input: ProofingStateInput): string {
  if (input.finalExists) return input.finalOutputVersionId ?? ORIGINAL_SELECTION
  return sortedProofingVersions(input.versions)[0]?.id ?? ORIGINAL_SELECTION
}

export function proofingFinalKey(input: ProofingStateInput): string {
  return input.finalExists ? input.finalOutputVersionId ?? ORIGINAL_SELECTION : ""
}

export function reconcileProofingSelection(
  current: string | undefined,
  input: ProofingStateInput,
  previousFinalKey: string
): string {
  const finalKey = proofingFinalKey(input)
  const currentExists = current === ORIGINAL_SELECTION
    || input.versions.some((version) => version.id === current)
  if (!current || !currentExists) return initialProofingSelection(input)
  if (finalKey && previousFinalKey !== finalKey) return finalKey
  return current
}

export function deriveProofingStatus(
  input: ProofingStateInput,
  selectedId = initialProofingSelection(input)
): ProofingStatus {
  if (input.finalExists) return "approved"
  const selected = input.versions.find((version) => version.id === selectedId)
  if (selected?.reviewState === "needs_changes") return "needs_changes"
  if (input.versions.length > 0) return "unreviewed"
  if (input.groupStatuses.some((status) => status === "running" || status === "queued")) {
    return "processing"
  }
  if (input.groupStatuses.some((status) => status === "failed")) return "needs_attention"
  return "unreviewed"
}

export function deriveProofingQaStatus(
  input: ProofingStateInput,
  selectedId = initialProofingSelection(input)
): ProofingQaStatus {
  if (selectedId === ORIGINAL_SELECTION) return "original"
  return input.versions.find((version) => version.id === selectedId)?.qaNeedsReview
    ? "review"
    : "ready"
}

export function proofingApprovalCounts(items: ProofingStateInput[]) {
  const approved = items.filter((item) => item.finalExists).length
  return { approved, total: items.length, remaining: items.length - approved }
}
