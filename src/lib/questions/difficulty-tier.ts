import { difficultyCopyFromEstimate } from '@/lib/questions/difficulty-copy';

/**
 * Maps the LLM's persisted `difficulty_estimate` to the tier vocabulary used
 * elsewhere in the app: Establishing / Solid / Mastery.
 */
export function difficultyEstimateToTierLabel(
  difficulty: string | null | undefined,
): string | null {
  const label = difficultyCopyFromEstimate(difficulty);
  return label ? label.toUpperCase() : null;
}
