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
import { generatedQuestions, masteryEvents, questions } from '@/server/db/schema';
import { empiricalMinSamples, resolveEffectiveDifficulty } from '@/server/daily/empirical-difficulty';

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
 * Persist the measured play aggregate onto the GENERATED bank row behind a
 * canonical question (R8, 2026-09-11).
 *
 * `GeneratedQuestion.n_answered` / `empirical_correct_rate` have existed since
 * the pool substrate landed and are read in two places — the dud exclusion in
 * rankAndFilterBankCandidates and resolveEffectiveDifficulty — but nothing on
 * the answer path ever WROTE them for machine rows, so they sat null on all but
 * 30 of 2,191 live rows. That left every tier self-label unchecked against real
 * play: there was no way to ask whether "accessible" is actually answered at the
 * ~78% the difficulty hint targets. See
 * audits/2026-09-11-Fable-QUESTION-DRIFT-PIPELINE-01.md §3.10.
 *
 * Idempotent by construction: both values are recomputed from the full
 * MASTERY_EVENTS history for the question and overwritten, never incremented,
 * so concurrent answers and re-runs converge instead of double-counting.
 * Best-effort — a telemetry write must never surface on an answer.
 */
export function empiricalPlayPatch(
  agg: PlayAggregate,
): { nAnswered: number; empiricalCorrectRate: number } | null {
  // One answerer is enough to record. The bug this replaces treated a single
  // play as "not worth writing", which is how the columns stayed empty on a
  // corpus where most questions are answered once or twice.
  if (agg.distinctAnswerers <= 0) return null;
  return {
    nAnswered: agg.distinctAnswerers,
    empiricalCorrectRate: agg.distinctCorrect / agg.distinctAnswerers,
  };
}

async function persistEmpiricalPlay(
  generatedQuestionId: string | null,
  agg: PlayAggregate,
): Promise<void> {
  const patch = empiricalPlayPatch(agg);
  if (!generatedQuestionId || !patch) return;
  try {
    await db
      .update(generatedQuestions)
      .set(patch)
      .where(eq(generatedQuestions.id, generatedQuestionId));
  } catch (error) {
    console.warn('[trust-promotion] empirical play write failed (telemetry only)', {
      generatedQuestionId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Evaluate + apply trust promotion / "nobody got it" flag for a question after a
 * scored answer. Best-effort and idempotent: the promotion UPDATE is guarded on
 * the current tier so a re-run never re-promotes, and the flag converges to the
 * decision. Callers invoke this fire-and-forget after writeMasteryEvent.
 */
export async function evaluateQuestionTrustOnPlay(questionId: string): Promise<void> {
  const agg = await readPlayAggregate(questionId);
  // Nothing scored yet — no aggregate to record and no threshold in reach.
  if (agg.distinctAnswerers <= 0) return;

  const minCorrect = humanValidatedMinCorrect();
  const minHolders = nobodyCorrectMinHolders();
  const minSamples = empiricalMinSamples();

  const [current] = await db
    .select({
      trustTier: questions.trustTier,
      nobodyCorrectFlag: questions.nobodyCorrectFlag,
      calibratedDifficulty: questions.calibratedDifficulty,
      difficultyEstimate: questions.difficultyEstimate,
      generatedQuestionId: questions.generatedQuestionId,
    })
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);
  if (!current) return;

  // Record the measured aggregate on EVERY scored answer, before the threshold
  // checks below. This used to sit behind the same "is a promotion/flag/recompute
  // in reach" exit as everything else, which is precisely why the counters were
  // empty: a question answered by one or two people — i.e. nearly all of them at
  // this scale — never reached any threshold and so was never recorded at all.
  await persistEmpiricalPlay(current.generatedQuestionId, agg);

  // Cheap exit: nothing further to do until a promotion, a flag, or an empirical
  // difficulty recompute is in reach.
  if (
    agg.distinctCorrect < minCorrect &&
    agg.distinctAnswerers < minHolders &&
    agg.distinctAnswerers < minSamples
  ) {
    return;
  }

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

  // D11 (B4 Phase 5): once enough humans have played, the measured correct rate
  // overrides the model's difficulty_estimate. Persist it to calibrated_difficulty
  // — the value serving + base-points already read — so the floor self-corrects.
  if (agg.distinctAnswerers >= minSamples) {
    const empiricalRate = agg.distinctCorrect / agg.distinctAnswerers;
    const effective = resolveEffectiveDifficulty({
      estimate: current.difficultyEstimate,
      empiricalRate,
      nAnswered: agg.distinctAnswerers,
      minSamples,
    });
    if (effective.source === 'empirical' && effective.difficulty !== current.calibratedDifficulty) {
      await db
        .update(questions)
        .set({ calibratedDifficulty: effective.difficulty })
        .where(eq(questions.id, questionId));
    }
  }
}
