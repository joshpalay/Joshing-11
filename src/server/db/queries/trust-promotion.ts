// Human-play trust promotion + "nobody got it" smell (PRD-D-5 §5.3 layer 3 / §6 /
// §7 / B4 Phase 2).
//
// Trust climbs with real play: a machine_verified question that N humans answer
// correctly earns human_validated (friend-facing eligible, §6). The inverse is a
// hallucination smell, not a hard question — a question that ENOUGH domain-holders
// answer with NOBODY getting it right is flagged for review (never auto-deleted —
// no decay, D8).
//
// The authoritative play log is MASTERY_EVENTS, keyed by the canonical Question
// id (question_id). "Correct" is any non-incorrect answer_state. An answerer can
// have more than one row for a question (the unique key includes source_type), so
// count(DISTINCT answered_by_user_id) is what collapses those to distinct humans.

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/server/db';
import { masteryEvents, questions } from '@/server/db/schema';

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** §7: human_validated after N=3 correct (with ≥1 wrong tolerated — we count
 *  correct distinct humans, so a mixed-in wrong answer never blocks promotion). */
export function humanValidatedMinCorrect(): number {
  return Math.max(1, Math.round(numEnv('TRUST_HUMAN_VALIDATED_MIN_CORRECT', 3)));
}

/** §7: "nobody got it" smell — 0% correct over ≥5 domain-holders. */
export function nobodyCorrectMinHolders(): number {
  return Math.max(1, Math.round(numEnv('TRUST_NOBODY_CORRECT_MIN_HOLDERS', 5)));
}

export interface PlayAggregate {
  /** Distinct humans whose recorded answer was correct (non-incorrect). */
  distinctCorrect: number;
  /** Distinct humans who answered at all (any scored state). */
  distinctAnswerers: number;
}

export type TrustTierValue = 'unverified' | 'machine_verified' | 'human_validated' | 'author_confirmed';

export interface TrustDecision {
  /** Tier to promote to, or null to leave the tier unchanged. */
  promoteTo: 'human_validated' | null;
  /** Desired value of nobody_correct_flag after this play. */
  nobodyCorrectFlag: boolean;
}

/**
 * Pure decision from a play aggregate + current tier. Fails toward NOT flagging
 * and NOT demoting:
 *  - Promote machine_verified → human_validated once enough distinct humans are
 *    correct. Only machine_verified is promoted (unverified hasn't earned its
 *    first tier; human_validated/author_confirmed are already at/above it).
 *  - Flag "nobody correct" only once enough distinct holders have tried AND none
 *    succeeded; the moment one human gets it right the flag clears (it was a hard
 *    question, not a broken one).
 */
export function decideTrustOnPlay(
  agg: PlayAggregate,
  currentTier: TrustTierValue,
  minCorrect: number = humanValidatedMinCorrect(),
  minHolders: number = nobodyCorrectMinHolders(),
): TrustDecision {
  const promoteTo =
    currentTier === 'machine_verified' && agg.distinctCorrect >= minCorrect ? 'human_validated' : null;
  const nobodyCorrectFlag = agg.distinctAnswerers >= minHolders && agg.distinctCorrect === 0;
  return { promoteTo, nobodyCorrectFlag };
}

/** A correct answer_state is any scored, non-incorrect state. */
const CORRECT_STATES = sql`('first_correct','first_correct_after_wrong','repeat_correct')`;

/** Read distinct-human play aggregates for a single canonical question. */
export async function readPlayAggregate(questionId: string): Promise<PlayAggregate> {
  const [row] = await db
    .select({
      distinctCorrect: sql<number>`count(distinct ${masteryEvents.answeredByUserId}) filter (where ${masteryEvents.answerState} in ${CORRECT_STATES})`,
      distinctAnswerers: sql<number>`count(distinct ${masteryEvents.answeredByUserId}) filter (where ${masteryEvents.answerState} is not null)`,
    })
    .from(masteryEvents)
    .where(eq(masteryEvents.questionId, questionId));
  return {
    distinctCorrect: Number(row?.distinctCorrect ?? 0),
    distinctAnswerers: Number(row?.distinctAnswerers ?? 0),
  };
}

/**
 * Evaluate + apply trust promotion / "nobody got it" flag for a question after a
 * scored answer. Best-effort and idempotent: the promotion UPDATE is guarded on
 * the current tier so a re-run never re-promotes, and the flag converges to the
 * decision. Callers invoke this fire-and-forget after writeMasteryEvent.
 */
export async function evaluateQuestionTrustOnPlay(questionId: string): Promise<void> {
  const agg = await readPlayAggregate(questionId);
  const minCorrect = humanValidatedMinCorrect();
  const minHolders = nobodyCorrectMinHolders();

  // Cheap exit: nothing to do until either threshold is in reach.
  if (agg.distinctCorrect < minCorrect && !(agg.distinctAnswerers >= minHolders)) return;

  const [current] = await db
    .select({ trustTier: questions.trustTier, nobodyCorrectFlag: questions.nobodyCorrectFlag })
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);
  if (!current) return;

  const decision = decideTrustOnPlay(
    agg,
    current.trustTier as TrustTierValue,
    minCorrect,
    minHolders,
  );

  if (decision.promoteTo) {
    // Guard on machine_verified so concurrent evaluations and re-runs are no-ops.
    await db
      .update(questions)
      .set({ trustTier: 'human_validated' })
      .where(and(eq(questions.id, questionId), eq(questions.trustTier, 'machine_verified')));
  }
  if (decision.nobodyCorrectFlag !== current.nobodyCorrectFlag) {
    await db
      .update(questions)
      .set({ nobodyCorrectFlag: decision.nobodyCorrectFlag })
      .where(eq(questions.id, questionId));
  }
}
