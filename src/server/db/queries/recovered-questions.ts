import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { db, masteryEvents, questions, recoveredSetAside } from '@/server/db';
import { pgErrorCode } from '@/server/db/pg-error';

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
  /** The viewer has set this one aside — it sorts to the bottom and dims. */
  setAside: boolean;
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
 * The viewer's active set-aside question ids (reinstatedAt IS NULL). Read-only,
 * and resilient to the table not existing yet: a pre-migration database returns
 * an empty set rather than failing the whole recovered page (mirrors
 * getDismissedDomains' 42P01 handling).
 */
async function getSetAsideQuestionIds(userId: string): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ questionId: recoveredSetAside.questionId })
      .from(recoveredSetAside)
      .where(and(eq(recoveredSetAside.userId, userId), isNull(recoveredSetAside.reinstatedAt)));
    return new Set(rows.map((r) => r.questionId));
  } catch (error) {
    if (pgErrorCode(error) === '42P01') return new Set(); // table not yet migrated
    throw error;
  }
}

/**
 * Returns the viewer's whole "ever recovered" pool. Read-only: SELECTs only, no
 * mastery coupling. The answer and explainer ship with the pool so the card can
 * reveal them client-side with no further round-trip and no grading — they sit
 * collapsed until the player chooses to check themselves.
 *
 * Ordering: most recently recovered first, but questions the viewer has SET
 * ASIDE are demoted to the bottom (recency preserved within each group). The
 * card dims a set-aside question and offers to restore it.
 */
export async function getRecoveredQuestionsForUser(userId: string): Promise<RecoveredQuestion[]> {
  const [rows, setAsideIds] = await Promise.all([
    db
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
      .orderBy(desc(masteryEvents.createdAt)),
    getSetAsideQuestionIds(userId),
  ]);

  const mapped: RecoveredQuestion[] = rows.map((row) => ({
    id: row.id,
    questionId: row.questionId,
    questionText: row.questionText,
    category: prettifyCategory(row.canonicalSubcategory, row.category),
    recoveredAt: row.recoveredAt,
    answer: row.answerText,
    explanation: row.explainerFull ?? row.explainerBrief ?? row.factualExplanation ?? null,
    creatorNote: row.creatorNote ?? null,
    setAside: setAsideIds.has(row.questionId),
  }));

  // Demote set-aside questions to the bottom; recency order is already in place
  // within each group from the ORDER BY, and a stable partition preserves it.
  return [...mapped.filter((q) => !q.setAside), ...mapped.filter((q) => q.setAside)];
}

/**
 * Set a recovered question aside for the viewer (reversible soft-dismiss). A
 * no-op if it is already set aside. The partial unique index guarantees at most
 * one active row per (user, question). Mirrors dismissDomain.
 */
export async function setAsideRecoveredQuestion(userId: string, questionId: string): Promise<void> {
  const [existing] = await db
    .select({ id: recoveredSetAside.id })
    .from(recoveredSetAside)
    .where(
      and(
        eq(recoveredSetAside.userId, userId),
        eq(recoveredSetAside.questionId, questionId),
        isNull(recoveredSetAside.reinstatedAt),
      ),
    )
    .limit(1);

  if (existing) return;

  await db.insert(recoveredSetAside).values({ userId, questionId });
}

/**
 * Restore a set-aside recovered question (un-demote it) by marking the active
 * row reinstated. A no-op if it was not set aside. Mirrors reinstateDomain.
 */
export async function restoreRecoveredQuestion(userId: string, questionId: string): Promise<void> {
  await db
    .update(recoveredSetAside)
    .set({ reinstatedAt: new Date() })
    .where(
      and(
        eq(recoveredSetAside.userId, userId),
        eq(recoveredSetAside.questionId, questionId),
        isNull(recoveredSetAside.reinstatedAt),
      ),
    );
}
