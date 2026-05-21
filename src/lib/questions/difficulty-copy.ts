export type QuestionDifficultyTier = 'establishing' | 'solid' | 'skilled' | 'master';
export type DifficultyEstimateValue = 'accessible' | 'moderate' | 'specialist';

export const DIFFICULTY_COPY: Record<number, string> = {
  1: 'Establishing',
  2: 'Establishing',
  3: 'Familiar',
  4: 'Solid',
  5: 'Mastery',
};

const TIER_COPY: Record<QuestionDifficultyTier, string> = {
  establishing: 'Establishing',
  solid: 'Familiar',
  skilled: 'Solid',
  master: 'Mastery',
};

const ESTIMATE_COPY: Record<DifficultyEstimateValue, string> = {
  accessible: 'Establishing',
  moderate: 'Familiar',
  specialist: 'Mastery',
};

export function difficultyCopyFromValue(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return DIFFICULTY_COPY[Math.round(value)] ?? null;
}

export function difficultyCopyFromTier(tier: string | null | undefined): string | null {
  if (!tier) return null;
  const normalized = tier.trim().toLowerCase();
  if (normalized === 'mastery') return TIER_COPY.master;
  return TIER_COPY[normalized as QuestionDifficultyTier] ?? null;
}

export function difficultyCopyFromEstimate(difficulty: string | null | undefined): string | null {
  if (!difficulty) return null;
  const normalized = difficulty.trim().toLowerCase();
  return ESTIMATE_COPY[normalized as DifficultyEstimateValue] ?? difficultyCopyFromTier(normalized);
}

export function difficultyCopyFromAssessment(value: string | number | null | undefined): string | null {
  if (typeof value === 'number') return difficultyCopyFromValue(value);
  return difficultyCopyFromEstimate(value);
}
