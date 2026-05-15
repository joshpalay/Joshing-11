/**
 * Game flow constants from PRD.
 * Pool minimum is per-group (minimum_questions_required); default 5.
 */
import { getBasePoints } from '@/server/mastery/scoring';
import type { AnswerState, DifficultyEstimate } from '@/types/db';
import { CATEGORIES } from '@/lib/questions-types';

export const QUESTIONS_PER_DAY = 5;
/** @deprecated Legacy flat scoring constant. Use `canonicalPointsForAnswer` instead. */
export const POINTS_PER_CORRECT = 3;
/** Daily reset hour in UTC — noon EST (UTC-5). New questions available at 17:00 UTC every day. */
export const DAILY_RESET_HOUR_UTC = 17;
export const DEFAULT_MINIMUM_QUESTIONS = 5;
export const MINIMUM_QUESTIONS_FLOOR = 5;
/** Max active members per group (join + invite enforcement). Product: 10. */
export const MAX_GROUP_SIZE = 10;
export const QUESTION_DOMAIN_KEYS = CATEGORIES;

/** After a daily assignment's `expires_at`, catch-up remains available for this many days (D3 Decision 2 / B6). */
export const CATCH_UP_ELIGIBLE_DAYS_AFTER_EXPIRY = 7;
export const CATCH_UP_ELIGIBLE_MS_AFTER_EXPIRY =
  CATCH_UP_ELIGIBLE_DAYS_AFTER_EXPIRY * 24 * 60 * 60 * 1000;

type CanonicalScoringInput = {
  difficulty: DifficultyEstimate | null | undefined;
  answerState: AnswerState | null | undefined;
  catchUp?: boolean;
};

/**
 * Canonical answer scoring:
 * - base points depend on difficulty + answer_state
 * - catch-up applies 0.25x
 * - repeat_correct / incorrect earn 0
 */
export function canonicalPointsForAnswer({
  difficulty,
  answerState,
  catchUp = false,
}: CanonicalScoringInput): number {
  if (answerState !== 'first_correct' && answerState !== 'first_correct_after_wrong') {
    return 0;
  }
  const basePoints = getBasePoints(difficulty ?? null, answerState);
  const weight = catchUp ? 0.25 : 1;
  return Math.round(basePoints * weight);
}

export function resolveLaunchThreshold(minimumRequired?: number | null): number {
  const raw = typeof minimumRequired === 'number' ? minimumRequired : DEFAULT_MINIMUM_QUESTIONS;
  return Math.max(MINIMUM_QUESTIONS_FLOOR, raw);
}
