/**
 * Maps the LLM's 3-tier `difficulty_estimate` to the tier vocabulary already used
 * elsewhere in the app (Establishing / Solid / Mastery). Surfaced as the badge
 * pill on each question card so players see how hard the question objectively is.
 */
export function difficultyEstimateToTierLabel(
  difficulty: string | null | undefined,
): string | null {
  if (difficulty === 'accessible') return 'ESTABLISHING';
  if (difficulty === 'moderate') return 'SOLID';
  if (difficulty === 'specialist') return 'MASTERY';
  return null;
}
