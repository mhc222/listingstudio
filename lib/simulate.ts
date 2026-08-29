// Dry-run cost estimator (phase 10). Pure config math — safe to import from
// client components; rates live in config/models.ts, never here.
import { pickProvider, MODELS, AVG_GENERATIONS_PER_FILE_GROUP, type ProviderKey } from "@/config/models"

export type Simulation = {
  provider: ProviderKey
  providerLabel: string
  // one generation per chain step per photo
  firstRunCents: number
  // includes average rework/QA-retry regenerations (CLAUDE.md assumption)
  expectedCents: number
}

export function simulateCents(chainLength: number, photoCount: number, hasRefs: boolean): Simulation {
  const provider = pickProvider(chainLength, hasRefs)
  const rate = MODELS[provider].costCents
  return {
    provider,
    providerLabel: MODELS[provider].label,
    firstRunCents: chainLength * rate * photoCount,
    expectedCents: AVG_GENERATIONS_PER_FILE_GROUP * rate * photoCount,
  }
}
