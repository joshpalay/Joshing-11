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
 * This surface is READ-ONLY by construction. It computes nothing new, writes
 * nothing, and does not touch the mastery system — it is a reflective pool, not
 * a drill. Decisions A–D in the D- doc:
 *   A. Pool = whole "ever recovered" set (no latest-state reduction, no
 *      retirement). A question stays even if later re-missed; the moment, not a
 *      current status, is what `first_correct_after_wrong` records.
 *   B. Interaction is silent self-reveal — the reveal lives entirely in the
 *      render (native <details> on the surface), never an answer submission.
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

export type RecoveredQuestion = {
  /** mastery_events.id — stable key for the recovered moment. */
  id: string;
  questionId: string;
  questionText: string;
  answerText: string;
  factualExplanation: string | null;
  /** Best available display category, already prettified for the eyebrow. */
  category: string;
  /** When the wrong→right moment was recorded. */
  recoveredAt: Date;
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
 * first. Read-only: a single SELECT, no writes, no mastery coupling.
 */
export async function getRecoveredQuestionsForUser(userId: string): Promise<RecoveredQuestion[]> {
  const rows = await db
    .select({
      id: masteryEvents.id,
      questionId: questions.id,
      questionText: questions.questionText,
      answerText: questions.answerText,
      factualExplanation: questions.factualExplanation,
      canonicalSubcategory: questions.canonicalSubcategory,
      category: questions.category,
      recoveredAt: masteryEvents.createdAt,
    })
    .from(masteryEvents)
    .innerJoin(questions, eq(questions.id, masteryEvents.questionId))
    .where(
      and(
        eq(masteryEvents.userId, userId),
        inArray(masteryEvents.sourceType, ANSWER_STATE_SOURCE_TYPES),
        eq(masteryEvents.answerState, 'first_correct_after_wrong'),
        isNotNull(masteryEvents.questionId),
      ),
    )
    .orderBy(desc(masteryEvents.createdAt));

  return rows.map((row) => ({
    id: row.id,
    questionId: row.questionId,
    questionText: row.questionText,
    answerText: row.answerText,
    factualExplanation: row.factualExplanation,
    category: prettifyCategory(row.canonicalSubcategory, row.category),
    recoveredAt: row.recoveredAt,
  }));
}
