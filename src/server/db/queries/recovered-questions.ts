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
 * This surface is READ-ONLY on the pool and does NOT check answers. The review
 * interaction is a no-check reveal — the deck ships the canonical answers
 * collapsed and reveals each on demand (see RecoveredDeck). Nothing is graded:
 * a review session mints zero `mastery_events` rows and never touches mastery,
 * feed fan-out, or promotion. The only write on the surface is the reversible
 * dismiss/restore (RecoveredSetAside, via /api/recovered/set-aside).
 *
 * Decisions A–D:
 *   A. Pool = whole "ever recovered" set (no latest-state reduction, no
 *      retirement). A question stays even if later re-missed; the moment, not a
 *      current status, is what `first_correct_after_wrong` records.
 *   B. No-check reveal: the player recalls the answer in their head, then
 *      reveals the canonical answer to check themselves. No grader, no verdict.
 *   C. The surface deals ONE question at a time from a shuffled deck (revised
 *      from the original recency-ordered list). An optional `withinDays` bound
 *      limits the deck to moments recovered that recently. Dismissed questions
 *      are out of circulation entirely — returned separately (all time, most
 *      recent first) so the viewer can browse and restore them.
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
  /** The viewer has dismissed this one — it is out of the deck's circulation. */
  setAside: boolean;
};

export type RecoveredPool = {
  /** Shuffled, range-bounded, not dismissed — the one-at-a-time rotation. */
  deck: RecoveredQuestion[];
  /**
   * Everything the viewer has dismissed, regardless of the range bound (the
   * dismissed shelf is a browsable archive, not a window), most recently
   * recovered first.
   */
  dismissed: RecoveredQuestion[];
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

/** Unbiased in-place Fisher–Yates shuffle. */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Returns the viewer's recovered pool, split for the one-at-a-time surface:
 * a shuffled DECK of questions still in circulation (optionally bounded to
 * moments recovered within the last `withinDays` days; null/undefined = all
 * time) and the DISMISSED shelf (every set-aside question, all time, most
 * recently recovered first — the range bound never hides a dismissal).
 *
 * Read-only: SELECTs only, no mastery coupling. Answers and explainers ship
 * with both lists so the deck can reveal them client-side with no further
 * round-trip and no grading.
 */
export async function getRecoveredQuestionsForUser(
  userId: string,
  { withinDays }: { withinDays?: number | null } = {},
): Promise<RecoveredPool> {
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
      // Recency order is kept for the dismissed shelf; the deck is shuffled below.
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

  const cutoff = withinDays == null ? null : Date.now() - withinDays * 24 * 60 * 60 * 1000;

  const deck = shuffle(
    mapped.filter(
      (q) => !q.setAside && (cutoff === null || q.recoveredAt.getTime() >= cutoff),
    ),
  );
  const dismissed = mapped.filter((q) => q.setAside);

  return { deck, dismissed };
}

/**
 * Dismiss a recovered question for the viewer (reversible — takes it out of
 * the deck's circulation). A no-op if it is already dismissed. The partial
 * unique index guarantees at most one active row per (user, question). Mirrors
 * dismissDomain.
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
 * Restore a dismissed recovered question (put it back in circulation) by
 * marking the active row reinstated. A no-op if it was not dismissed. Mirrors
 * reinstateDomain.
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
