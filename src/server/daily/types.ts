/**
 * B9 — Personal Daily Mode shared types.
 *
 * QueueSlot is the per-slot shape persisted in DailyQueue.slots (JSONB)
 * and returned to the client from the queue / answer endpoints.
 */

import type { DifficultyEstimate } from '@/types/db';

type DailyDifficultyEstimate = DifficultyEstimate | 'accessible' | 'moderate' | 'specialist';

export type QueueSlotSource = 'friend' | 'bot' | 'community';
export type QueueSlotAnswerState = 'correct' | 'incorrect';

export type QueueSlot = {
  slot_index: number;
  source: QueueSlotSource;
  /** Canonical Question.id — only present when source = 'friend'. */
  question_id?: string;
  /** GeneratedQuestion.id — only present when source = 'bot'. */
  generated_question_id?: string;
  /** Authoring user id — only present when source = 'friend'. */
  author_id?: string;
  /** Display name for UI attribution — null if friend has no display_name. */
  author_name?: string | null;
  /** Optional creator note — only ever set for friend questions. */
  author_note?: string | null;
  domain: string;
  question_text: string;
  answered: boolean;
  answer_state?: QueueSlotAnswerState;
  /** Text the player typed; persisted so the summary screen can show it. */
  submitted_answer?: string;
  /** Points earned for this slot (stored so summary screen can split friend/bot totals). */
  awarded_points?: number;
  /** Skip marker — true if the player skipped this slot. See Phase 4 skip mechanic. */
  skipped?: boolean;
  /** Catch-up dismissal marker; dismissed slots stop appearing in catch-up. */
  dismissed_at?: string;
  dismissed_reason?: 'not_interested' | 'too_old' | 'unclear';
  /**
   * True when the effective difficulty for this slot's domain was stepped up above the
   * user's base preference due to mastery progress. Used by the UI to show "Getting harder".
   */
  difficulty_stepped_up?: boolean;
  /** Filled on answer; lets session/summary re-render the reveal after the player taps NEXT. */
  reveal_canonical_answer?: string;
  reveal_explainer?: string;
  /** Short contextual breadcrumb shown in the chat thread after grading. */
  reveal_breadcrumb?: string | null;
  /** Joshing Bot quip for this turn (null if the LLM returned nothing). */
  reveal_quip?: string | null;
};

/**
 * Phase 4 skip mechanic — capped at 3 skips per round, server-enforced.
 * A skip writes a SkippedDailyQuestion row and temporarily cools that question
 * down in the queue builder.
 */
export const DAILY_SKIP_LIMIT = 5;

export const PERSONAL_DAILY_SESSION_CONTEXT = 'personal_daily';
export const DAILY_QUEUE_SIZE = 5;

/**
 * Difficulty → base points for B9 personal daily. Always prefer
 * calibrated_difficulty, fall back to llm_difficulty, then difficulty_estimate.
 */
export const DAILY_BASE_POINTS = {
  specialist: 100,
  moderate: 50,
  accessible: 10,
} as Record<DailyDifficultyEstimate, number>;

export const FRIEND_WEIGHT = 1.0;
export const BOT_WEIGHT = 1.0;

export function resolveDailyBasePoints(
  difficulty: DailyDifficultyEstimate | string | null | undefined
): number {
  if (!difficulty) return DAILY_BASE_POINTS.moderate;
  if (difficulty === 'specialist' || difficulty === 'moderate' || difficulty === 'accessible') {
    return DAILY_BASE_POINTS[difficulty];
  }
  return DAILY_BASE_POINTS.moderate;
}
