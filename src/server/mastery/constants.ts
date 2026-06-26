/**
 * Single source of truth for mastery scoring constants.
 *
 * Tier thresholds live in src/server/mastery/tiers.ts (separate file because
 * effectiveTier() depends on them transitively). Everything else mastery
 * routes need to multiply by should be defined here.
 */

import type { DifficultyEstimate } from '@/types/db'

type LegacyDifficulty =
  | DifficultyEstimate
  | 'accessible'
  | 'moderate'
  | 'specialist'

/** Live answer surfaces (Daily, Feed, joshing-game) award full base credit. */
export const LIVE_SURFACE_WEIGHT = 1

/**
 * Catch-up answers (untimed, after the daily window closed) award 25% of
 * live base credit. PRD §8.32.
 */
export const CATCHUP_SURFACE_WEIGHT = 0.25

/**
 * Recovery (first_correct_after_wrong) is the multiplier applied to the full
 * first-correct base when the user previously answered the same question
 * wrong. PRD §8.32. This is the single knob for recovery credit
 * (`D-RECOVERY-SCORING-UNIFY-01`, Decision A1): recovery = round(first_correct
 * base × RECOVERY_STATE_WEIGHT), and the `first_correct_after_wrong` columns
 * below are held equal to it by a per-tier invariant test.
 *
 * It is selected *instead of*, not stacked *on top of*, the catch-up surface
 * weight (Decision D1): a wrong-then-right answer earns 25% of the full live
 * base whether it lands live or in catch-up — NOT CATCHUP_SURFACE_WEIGHT ×
 * RECOVERY_STATE_WEIGHT (6.25%). See `canonicalPointsForAnswer`.
 */
export const RECOVERY_STATE_WEIGHT = 0.25

/**
 * Author credit weight (PRD-locked rule, pending F2.5 product clarification).
 * Multiplies the difficulty's first_correct base. Awarded once per
 * (question, answering player) on moderate/specialist questions only. Not
 * currently used by the shipped author-credit implementation — see
 * creatorMasteryAwardForNthCorrect in scoring.ts.
 */
export const AUTHOR_CREDIT_WEIGHT = 0.5

/**
 * §8.32 base points by (difficulty, answer_state). repeat_correct and
 * incorrect always award 0; we only enumerate the awarding states here.
 */
export const DIFFICULTY_BASE_POINTS = {
  specialist: { first_correct: 100, first_correct_after_wrong: 25 },
  moderate: { first_correct: 50, first_correct_after_wrong: 13 },
  accessible: { first_correct: 10, first_correct_after_wrong: 3 },
} as const satisfies Record<
  LegacyDifficulty,
  { first_correct: number; first_correct_after_wrong: number }
>

/**
 * Portrait / declared-proven weighting — NOT the §8.32 mastery point table.
 * Used by portrait-related surfaces to weight a difficulty alongside other
 * factors.
 */
export const PORTRAIT_DIFFICULTY_WEIGHT = {
  accessible: 1,
  moderate: 2,
  specialist: 3,
} as const satisfies Record<LegacyDifficulty, number>
