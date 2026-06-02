/**
 * B9 — Personal Daily Mode shared types.
 *
 * QueueSlot is the per-slot shape persisted in DailyQueue.slots (JSONB)
 * and returned to the client from the queue / answer endpoints.
 *
 * The Zod schema (queueSlotSchema) is the source of truth; the TypeScript
 * type is derived from it so the two stay in sync automatically (PRD §8.1.14).
 */

import { z } from 'zod';
import type { DifficultyEstimate } from '@/types/db';

type DailyDifficultyEstimate = DifficultyEstimate | 'accessible' | 'moderate' | 'specialist';

// 'house' (D-3) — a labeled non-human house/editorial question seeded into the
// Daily core to ease content scarcity in sparse niches. Carries a canonical
// question_id (source='house_authored', creatorId null) and author_name='Joshing'
// with no author_id (the house identity is never a users.id). 'community' is a
// legacy enum value, never produced by any picker.
export const queueSlotSourceSchema = z.enum(['friend', 'bot', 'community', 'house']);
export const queueSlotAnswerStateSchema = z.enum(['correct', 'incorrect']);

export const queueSlotSchema = z.object({
  slot_index: z.number().int(),
  source: queueSlotSourceSchema,
  /** Canonical Question.id — only present when source = 'friend'. */
  question_id: z.string().optional(),
  /** GeneratedQuestion.id — only present when source = 'bot'. */
  generated_question_id: z.string().optional(),
  /** Authoring user id — only present when source = 'friend'. */
  author_id: z.string().optional(),
  /** Display name for UI attribution — null if friend has no display_name. */
  author_name: z.string().nullish(),
  /** Optional creator note — only ever set for friend questions. */
  author_note: z.string().nullish(),
  /**
   * Bonus-slot presence attribution (Daily Five +2, D-4 §B). Set only on a +2
   * bonus slot — a FRESHLY GENERATED accessible question in a domain drawn from
   * the territory ∪ activity of people the viewer follows. The presence of these
   * fields is what marks a slot as a bonus slot. The question itself is a
   * generated question (source='bot', generated_question_id set), so these fields
   * describe WHERE the domain came from ("from {Name}'s world"), not who authored
   * or answered the question — there is no literal answerer. (Replaces the retired
   * answerer_id/answerer_name from the literal-question +2.)
   */
  presence_source_id: z.string().optional(),
  /** Display name for "from {Name}'s world" — null if the friend has no display_name. */
  presence_source_name: z.string().nullish(),
  /**
   * Count of ADDITIONAL followed friends whose world surfaces this domain (beyond
   * the named, most-recent one). > 0 → render "{Name} and others"; 0/absent →
   * just "{Name}".
   */
  presence_source_extra_count: z.number().int().optional(),
  domain: z.string(),
  /** Free-text broader topic for this slot (e.g. "Saturday morning cartoons"). Optional — populated for newly built slots. */
  broad_category: z.string().nullish(),
  /** Top-level category enum value (e.g. "film_tv"). Optional — populated for newly built slots from canonical Question rows. */
  category: z.string().nullish(),
  question_text: z.string(),
  /** LLM-rated objective difficulty for this question, surfaced as a badge in the UI. */
  difficulty_estimate: z.enum(['accessible', 'moderate', 'specialist']).optional(),
  answered: z.boolean(),
  answer_state: queueSlotAnswerStateSchema.optional(),
  /** Text the player typed; persisted so the summary screen can show it. */
  submitted_answer: z.string().optional(),
  /** Points earned for this slot (stored so summary screen can split friend/bot totals). */
  awarded_points: z.number().optional(),
  /** Skip marker — true if the player skipped this slot. See Phase 4 skip mechanic. */
  skipped: z.boolean().optional(),
  /** Catch-up dismissal marker; dismissed slots stop appearing in catch-up. */
  dismissed_at: z.string().optional(),
  dismissed_reason: z.enum(['not_interested', 'too_old', 'unclear']).optional(),
  /**
   * True when the effective difficulty for this slot's domain was stepped up above the
   * user's base preference due to mastery progress. Used by the UI to show "Getting harder".
   */
  difficulty_stepped_up: z.boolean().optional(),
  /** Filled on answer; lets session/summary re-render the reveal after the player taps NEXT. */
  reveal_canonical_answer: z.string().optional(),
  reveal_explainer: z.string().optional(),
  /** Short contextual breadcrumb shown in the chat thread after grading. */
  reveal_breadcrumb: z.string().nullish(),
  /** LLM consolation quip for near-miss wrong answers (PRD §8.1.14). */
  reveal_quip: z.string().nullish(),
  /** LLM-generated aside; for authored questions only populated when the viewer is the creator or an active friend, for LLM-origin questions always populated. */
  reveal_inside_joke: z.string().nullish(),
  /** Provenance of the aside label: 'relational' (a person authored it) or 'editorial' (LLM-origin). */
  reveal_inside_joke_kind: z.enum(['relational', 'editorial']).nullish(),
  /** Optional appeal state after a player asks the app to recheck a wrong grade. */
  recheck_status: z.enum(['accepted', 'rejected', 'needs_human']).optional(),
  /** Short player-facing explanation from the recheck reviewer. */
  recheck_reason: z.string().nullish(),
});

export type QueueSlotSource = z.infer<typeof queueSlotSourceSchema>;
export type QueueSlotAnswerState = z.infer<typeof queueSlotAnswerStateSchema>;
export type QueueSlot = z.infer<typeof queueSlotSchema>;

/**
 * Phase 4 skip mechanic — capped at 3 skips per round, server-enforced.
 * A skip writes a SkippedDailyQuestion row and temporarily cools that question
 * down in the queue builder.
 */
export const DAILY_SKIP_LIMIT = 5;

export const PERSONAL_DAILY_SESSION_CONTEXT = 'personal_daily';
export const DAILY_QUEUE_SIZE = 5;

/**
 * Daily Five +2 — up to this many bonus slots are appended after the core
 * DAILY_QUEUE_SIZE, each a freshly generated accessible question in a domain
 * drawn from the territory ∪ activity of people the viewer follows (D-4 §B; see
 * getFriendDomainsForBonus + generateBonusQuestionsForDomains). Total queue size
 * is therefore 5–7. This is additive and independent of the orchestrator's N<5
 * generation backstop: a bonus shortfall simply appends fewer slots, never
 * backfills, and never pads with the viewer's own domains.
 */
export const DAILY_BONUS_SLOT_MAX = 2;

/** A slot the player can still act on (neither answered nor skipped). */
export function hasPendingSlot(slots: QueueSlot[]): boolean {
  return slots.some((slot) => !slot.answered && !slot.skipped);
}

/**
 * A round is complete once it has slots and none of them are still pending.
 *
 * This is the canonical definition of "done" — the status API and the play
 * page both derive from it so the home card and the player can't disagree
 * (a skipped-but-unreplaced slot used to leave the round advertising "Resume"
 * while the player bounced straight to the summary).
 */
export function isRoundComplete(slots: QueueSlot[]): boolean {
  return slots.length > 0 && !hasPendingSlot(slots);
}

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
