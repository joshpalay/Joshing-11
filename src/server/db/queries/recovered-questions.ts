import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import { db, masteryEvents, questions } from '@/server/db';
import type { GradableQuestionType } from '@/server/grading';

/**
 * D-REVIEW-RECOVERED-01 — the "Recovered Questions" review pool (Version A).
 *
 * The pool is every question for which the viewer has a
 * `first_correct_after_wrong` answer-state event: the wrong→right moment
 * (computeAnswerState, src/server/answer-state.ts), written at insert time by
 * the shared answer pipeline across all five live answer surfaces.
 *
 * This surface is READ-ONLY. The reflective pool is a SELECT; the review
 * interaction (Decision B) grades a typed answer for real via `gradeAnswer` but
 * runs NONE of the persistence tail (no `deriveAnswerOutcome`, no
 * `writeMasteryEvent`, no feed fan-out, no mastery promotion) — so a review
 * submission mints zero `mastery_events` rows and never touches mastery.
 *
 * Decisions A–D:
 *   A. Pool = whole "ever recovered" set (no latest-state reduction, no
 *      retirement). A question stays even if later re-missed; the moment, not a
 *      current status, is what `first_correct_after_wrong` records.
 *   B. Graded, non-persisting answer form (grading lives in the route; this
 *      module supplies the gradable fields, guarded by pool membership).
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
};

/**
 * The gradable fields for one recovered question, returned ONLY when the
 * question is in the viewer's recovered pool. The inner join on mastery_events
 * is the membership guard: a question the viewer never recovered yields null,
 * so the review route can't be used to grade arbitrary questions. Read-only.
 */
export type RecoveredGradingQuestion = {
  questionId: string;
  questionText: string;
  answerText: string;
  acceptedAlternatives: string[];
  questionType: GradableQuestionType;
  /** Revealed alongside the verdict; never sent to the client before a submit. */
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
 * is deliberately NOT selected here — it is revealed only through the graded
 * review submission, so it never ships in the page payload before a recall.
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
  }));
}

/**
 * Loads the gradable fields for `questionId` IFF it is in `userId`'s recovered
 * pool (the inner join on the matching mastery event is the membership guard).
 * Returns null otherwise. Read-only — the review route grades against these
 * fields and persists nothing.
 */
export async function getRecoveredGradingQuestion(
  userId: string,
  questionId: string,
): Promise<RecoveredGradingQuestion | null> {
  const [row] = await db
    .select({
      questionId: questions.id,
      questionText: questions.questionText,
      answerText: questions.answerText,
      acceptedAlternatives: questions.acceptedAlternatives,
      questionType: questions.questionType,
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
        eq(masteryEvents.questionId, questionId),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    questionId: row.questionId,
    questionText: row.questionText,
    answerText: row.answerText,
    acceptedAlternatives: row.acceptedAlternatives,
    questionType: row.questionType,
    explanation: row.explainerFull ?? row.explainerBrief ?? row.factualExplanation ?? null,
    creatorNote: row.creatorNote ?? null,
  };
}
