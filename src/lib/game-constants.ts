/**
 * Game flow constants from PRD.
 * Pool minimum is per-group (minimum_questions_required); default 5.
 */
import { getBasePoints } from '@/server/mastery/scoring';
import {
  CATCHUP_SURFACE_WEIGHT,
  LIVE_SURFACE_WEIGHT,
  RECOVERY_STATE_WEIGHT,
} from '@/server/mastery/constants';
import type { AnswerState, DifficultyEstimate } from '@/types/db';
import { CATEGORIES } from '@/lib/questions-types';

export const QUESTIONS_PER_DAY = 5;
/** @deprecated Legacy flat scoring constant. Use `canonicalPointsForAnswer` instead. */
export const POINTS_PER_CORRECT = 3;
/** Global daily reset boundary, in UTC. Every player worldwide shares this instant; UI formats it into each viewer's local timezone. */
export const DAILY_RESET_HOUR_UTC = 17;
export const DEFAULT_MINIMUM_QUESTIONS = 5;
export const MINIMUM_QUESTIONS_FLOOR = 5;
/** Max active members per group (join + invite enforcement). Product: 10. */
export const MAX_GROUP_SIZE = 10;
export const QUESTION_DOMAIN_KEYS = CATEGORIES;

/** After a daily assignment's `expires_at`, catch-up remains available for this many days (D3 Decision 2 / B6). */
export const CATCH_UP_ELIGIBLE_DAYS_AFTER_EXPIRY = 7;

/**
 * Catch-up plays in rounds of this many questions, mirroring the Daily Five.
 * After each round the player sees a summary and can choose to play the next
 * round or stop. Kept at 5 to match `QUESTIONS_PER_DAY`.
 */
export const CATCH_UP_BATCH_SIZE = 5;
export const CATCH_UP_ELIGIBLE_MS_AFTER_EXPIRY =
  CATCH_UP_ELIGIBLE_DAYS_AFTER_EXPIRY * 24 * 60 * 60 * 1000;

type CanonicalScoringInput = {
  difficulty: DifficultyEstimate | null | undefined;
  answerState: AnswerState | null | undefined;
  catchUp?: boolean;
};

/**
 * Canonical answer scoring — the single source of truth for answer points
 * across all five answer routes (daily, catch-up, feed, lately, questions).
 * See `D-RECOVERY-SCORING-UNIFY-01` in DECISIONS.md.
 *
 * Decision A1 (the multiply path) is authoritative: every award is
 *   round(first_correct_base × weight)
 * where `first_correct_base = getBasePoints(difficulty, 'first_correct')` and
 * the weight is selected by (answer_state, surface):
 *   - first_correct, live              → LIVE_SURFACE_WEIGHT    (1)
 *   - first_correct, catch-up          → CATCHUP_SURFACE_WEIGHT (0.25)
 *   - first_correct_after_wrong        → RECOVERY_STATE_WEIGHT  (0.25), live OR catch-up
 *   - repeat_correct / incorrect       → 0
 *
 * Decision D1: recovery does NOT stack the catch-up weight onto the recovery
 * weight. A wrong-then-right answer earns 25% of the full live base whether it
 * lands live or in catch-up — the recovery weight is selected *instead of* the
 * catch-up weight, never multiplied on top of it. (The catch-up routes already
 * computed this; only the helper's original body diverged.)
 *
 * Because `RECOVERY_STATE_WEIGHT` is the single knob, the
 * `first_correct_after_wrong` table column is now derived — the live routes
 * that historically read that column stay byte-identical only while
 * `round(first_correct × RECOVERY_STATE_WEIGHT) === first_correct_after_wrong`
 * holds, which the per-tier invariant test (Decision C1) pins.
 */
export function canonicalPointsForAnswer({
  difficulty,
  answerState,
  catchUp = false,
}: CanonicalScoringInput): number {
  if (answerState !== 'first_correct' && answerState !== 'first_correct_after_wrong') {
    return 0;
  }
  const firstCorrectBase = getBasePoints(difficulty ?? null, 'first_correct');
  const weight =
    answerState === 'first_correct_after_wrong'
      ? RECOVERY_STATE_WEIGHT
      : catchUp
        ? CATCHUP_SURFACE_WEIGHT
        : LIVE_SURFACE_WEIGHT;
  return Math.round(firstCorrectBase * weight);
}

export function resolveLaunchThreshold(minimumRequired?: number | null): number {
  const raw = typeof minimumRequired === 'number' ? minimumRequired : DEFAULT_MINIMUM_QUESTIONS;
  return Math.max(MINIMUM_QUESTIONS_FLOOR, raw);
}
