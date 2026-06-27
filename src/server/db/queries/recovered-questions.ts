import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import { db, masteryEvents, questions } from '@/server/db';

/**
 * D-REVIEW-RECOVERED-01 — the "Recovered Questions" review pool (Version A).
 *
 * The pool is every question for which the viewer has a
 * `first_correct_after_wrong` answer-state event: the wrong→right moment
 * (computeAnswerState, src/server/answer-state.ts), written at insert time by
 * the shared answer pipeline across all five live answer surfaces.
 *
 * This surface is READ-ONLY and does NOT check answers. The reflective pool is
 * a single SELECT; the review interaction is a no-check reveal — the card ships
 * the canonical answer collapsed and reveals it on demand (a native <details>,
 * see RecoveredCard). Nothing is graded and nothing is written: a review
 * submission mints zero `mastery_events` rows and never touches mastery, feed
 * fan-out, or promotion.
 *
 * Decisions A–D:
 *   A. Pool = whole "ever recovered" set (no latest-state reduction, no
 *      retirement). A question stays even if later re-missed; the moment, not a
 *      current status, is what `first_correct_after_wrong` records.
 *   B. No-check reveal: the player recalls the answer in their head, then
 *      reveals the canonical answer to check themselves. No grader, no verdict.
 *   C. Ordering is recency: ORDER BY created_at DESC.
 *
 * `answer_state` only carries a value on the `live_correct` / `catchup_correct`
 * source types, and `question_id` is nullable on mastery_events — hence the
 * source-type narrowing, the `question_id IS NOT NULL` guard, and the inner
 * join, so no orphan rows surface. Filter + ordering are covered by the
 * existing (user_id, source_type, answer_state, created_at) composite index;
 * no migration, no new columns, no new tables.
 */

// The surface source types that carry an answer_state (see the Lately reader,
// where the same naming caveat is documented): these gate by SURFACE, not by
// correctness. Correctness lives in answer_state.
const ANSWER_STATE_SOURCE_TYPES = ['live_correct', 'catchup_correct'] as const;
const RECOVERED_STATE = 'first_correct_after_wrong' as const;

export type RecoveredQuestion = {
  /** mastery_events.id — stable key for the recovered moment. */
  id: string;
  questionId: string;
  questionText: string;
  /** Best available display category, already prettified for the eyebrow. */
  category: string;
  /** When the wrong→right moment was recorded. */
  recoveredAt: Date;
  /** The canonical answer — shipped collapsed, revealed on the card (no check). */
  answer: string;
  /** Revealed alongside the answer when present. */
  explanation: string | null;
  creatorNote: string | null;
};

const CATEGORY_ENUM_PRETTY: Record<string, string> = {
  music: 'music',
  literature: 'literature',
  history: 'history',
  film_tv: 'film & TV',
  sport: 'sport',
  science: 'science',
  philosophy: 'philosophy',
  pop_culture: 'pop culture',
  language: 'language',
  general_knowledge: 'general knowledge',
};

function prettifyCategory(canonical: string | null, coarse: string | null): string {
  const trimmed = canonical?.trim();
  if (trimmed) return trimmed;
  if (coarse && CATEGORY_ENUM_PRETTY[coarse]) return CATEGORY_ENUM_PRETTY[coarse];
  return 'something';
}

/**
 * Returns the viewer's whole "ever recovered" pool, most recently recovered
 * first. Read-only: a single SELECT, no writes, no mastery coupling. The answer
 * and explainer ship with the pool so the card can reveal them client-side with
 * no further round-trip and no grading — they sit collapsed until the player
 * chooses to check themselves.
 */
export async function getRecoveredQuestionsForUser(userId: string): Promise<RecoveredQuestion[]> {
  const rows = await db
    .select({
      id: masteryEvents.id,
      questionId: questions.id,
      questionText: questions.questionText,
      canonicalSubcategory: questions.canonicalSubcategory,
      category: questions.category,
      recoveredAt: masteryEvents.createdAt,
      answerText: questions.answerText,
      explainerFull: questions.explainerFull,
      explainerBrief: questions.explainerBrief,
      factualExplanation: questions.factualExplanation,
      creatorNote: questions.creatorNote,
    })
    .from(masteryEvents)
    .innerJoin(questions, eq(questions.id, masteryEvents.questionId))
    .where(
      and(
        eq(masteryEvents.userId, userId),
        inArray(masteryEvents.sourceType, ANSWER_STATE_SOURCE_TYPES),
        eq(masteryEvents.answerState, RECOVERED_STATE),
        isNotNull(masteryEvents.questionId),
      ),
    )
    .orderBy(desc(masteryEvents.createdAt));

  return rows.map((row) => ({
    id: row.id,
    questionId: row.questionId,
    questionText: row.questionText,
    category: prettifyCategory(row.canonicalSubcategory, row.category),
    recoveredAt: row.recoveredAt,
    answer: row.answerText,
    explanation: row.explainerFull ?? row.explainerBrief ?? row.factualExplanation ?? null,
    creatorNote: row.creatorNote ?? null,
  }));
}
