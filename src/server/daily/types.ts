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
  /**
   * Missed-question return marker (D-MISSED-RETURN-01 §2 R3). Set only on an
   * APPENDED return slot — a canonical question the viewer previously got wrong,
   * or one that expired unanswered and aged out of catch-up. The presence of
   * `return_scope` is what marks a slot as a return slot, following the same
   * marker-field convention as `presence_source_*` above rather than adding a
   * slot-kind enum. Like a bonus slot, a return slot is ADDITIVE and never
   * counts toward the five — see isReturnSlot / getCoreSlots in ./bonus.
   *
   * The two scopes are deliberately different (§2): 'wrong' is a return and must
   * be visibly marked as one (R9, provenance canon — never disguised as new),
   * while 'expired' has never been seen and must carry NO return framing at all;
   * it reads as a normal question that happens to be arriving late.
   */
  return_scope: z.enum(['wrong', 'expired']).optional(),
  /**
   * The date the viewer last saw this question — the wrong answer, or the queue
   * date it expired on. Feeds the honest return label ("from March 4", R9). ISO
   * date string.
   */
  return_last_seen_at: z.string().optional(),
  /** Which return this is (1-based) for the 'wrong' scope. Telemetry + copy. */
  return_count: z.number().int().optional(),
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
   * Catch-up recovery state — kept SEPARATE from the live `answer_state`,
   * `submitted_answer`, and `awarded_points` above. Re-answering a slot in
   * catch-up must never rewrite the live-round verdict (that drives the daily
   * progress dots and the summary totals); the original wrong/skipped result
   * stays put. A `catchup_answer_state` of 'correct' closes the slot for
   * catch-up (see isCatchUpSlotEligible); 'incorrect' leaves it re-attemptable.
   */
  catchup_answer_state: queueSlotAnswerStateSchema.optional(),
  /** Text the player typed in their most recent catch-up attempt. */
  catchup_submitted_answer: z.string().optional(),
  /** Points earned in catch-up (the recovery weight), distinct from the live awarded_points. */
  catchup_awarded_points: z.number().optional(),
  /** ISO timestamp of the most recent catch-up attempt on this slot. */
  catchup_answered_at: z.string().optional(),
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
  /**
   * Catch-up appeal state — kept SEPARATE from the live `recheck_status` above,
   * mirroring how `catchup_answer_state` is kept separate from `answer_state`. A
   * catch-up attempt graded wrong can be appealed once; an 'accepted' verdict
   * flips `catchup_answer_state` to 'correct' (the live verdict stays put).
   */
  catchup_recheck_status: z.enum(['accepted', 'rejected', 'needs_human']).optional(),
  /** Short player-facing explanation from the catch-up recheck reviewer. */
  catchup_recheck_reason: z.string().nullish(),
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
 * Minimum number of core slots a Daily Five may be SERVED with. The orchestrator
 * tries hard to reach DAILY_QUEUE_SIZE (looping bounded top-up generation through
 * the same strict quality gates), but some niche / nearly-exhausted knowledge
 * bases genuinely can't yield five distinct, high-quality questions in one build.
 *
 * Graceful-degrade tolerates a short queue down to this floor — a real,
 * multi-question session still beats a retryable 503. BELOW it, the build is
 * treated as failed (DailyQueueFillError 'generation_failed' → retryable 503),
 * so the player sees the retry UI and the daily cron rebuilds a full set later
 * rather than being served a degenerate one- or two-question "Daily Five".
 *
 * We never pad to this floor by relaxing the quality/factual/dedup gates — a
 * short queue is always the GOOD questions that survived, never filler.
 */
export const DAILY_QUEUE_MIN_SIZE = 3;

/**
 * Intra-day diversity cap. Within a SINGLE daily queue, one canonical subcategory
 * may fill at most this many of the DAILY_QUEUE_SIZE core slots before further
 * same-subcategory picks are deflected. This is the lever that breaks up a
 * "5-question botany run" or a "3-Hamlet day" — where one niche crowds the rest of
 * the five out — without changing how individual questions are chosen.
 *
 * It is deliberately SOFT. The orchestrator holds cap-deflected picks in a reserve
 * and uses them to backfill only if the cap would otherwise leave the queue short,
 * and it scales the effective cap up when too few distinct subcategories are
 * available to field five under it (DAILY_QUEUE_SIZE / distinct-domain-count). So a
 * thin, single-subcategory knowledge base degrades to exactly the queue it would
 * have built without the cap — never shorter, never a spurious generation_failed.
 */
export const DAILY_QUEUE_MAX_PER_SUBCATEGORY = 2;

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
