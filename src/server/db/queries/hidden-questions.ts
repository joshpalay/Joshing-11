/**
 * Permanent per-question hiding — the "Never show this question again" scope of
 * the Not-for-me sheet.
 *
 * Three scopes sit behind that one control, and they live in three different
 * places on purpose:
 *  - "Skip for now"        → SkippedDailyQuestion (queue-scoped, temporary)
 *  - "Never this question" → HERE (durable, reversible)
 *  - "Rest this category"  → DailyPreference.domainPreferenceFrequency = 'resting'
 *
 * Hiding is reversible by design: restoreQuestion DELETES the row. That is the
 * condition under which permanent hiding is safe against a finite pool
 * (D-SUPPLY-FINITE-SET-01) — nothing is burned out of the corpus for good, so a
 * mis-tap costs the player one trip to Settings rather than a lost question.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';

import { db, generatedQuestions, hiddenQuestions, questions } from '@/server/db';

/** The two id spaces a hidden question can live in. Both are looked up per build. */
export type HiddenQuestionIds = {
  /** Canonical `Question.id` values the player has hidden. */
  questionIds: Set<string>;
  /** `GeneratedQuestion.id` values the player has hidden. */
  generatedQuestionIds: Set<string>;
};

export const EMPTY_HIDDEN_IDS: HiddenQuestionIds = {
  questionIds: new Set(),
  generatedQuestionIds: new Set(),
};

/**
 * Every question this player has hidden, as two id sets.
 *
 * Read on every Daily Five build. Unlike the cooldown/diversity gates, a hit
 * here is an ABSOLUTE drop — a hidden question is never reserved, never used as
 * backfill, and never promoted to fill a short core. The player said never.
 */
export async function getHiddenQuestionIds(userId: string): Promise<HiddenQuestionIds> {
  const rows = await db
    .select({
      questionId: hiddenQuestions.questionId,
      generatedQuestionId: hiddenQuestions.generatedQuestionId,
    })
    .from(hiddenQuestions)
    .where(eq(hiddenQuestions.userId, userId));

  const result: HiddenQuestionIds = {
    questionIds: new Set<string>(),
    generatedQuestionIds: new Set<string>(),
  };
  for (const row of rows) {
    if (row.questionId) result.questionIds.add(row.questionId);
    if (row.generatedQuestionId) result.generatedQuestionIds.add(row.generatedQuestionId);
  }
  return result;
}

/**
 * Hide one question for one player. Idempotent: hiding an already-hidden
 * question is a no-op rather than a duplicate row, so a double-tap on a slow
 * connection can't produce two entries in the Settings list.
 *
 * Exactly one of questionId / generatedQuestionId should be set, mirroring how
 * a queue slot addresses its question.
 */
export async function hideQuestion(input: {
  userId: string;
  questionId?: string | null;
  generatedQuestionId?: string | null;
  canonicalSubcategory: string;
}): Promise<void> {
  const { userId, questionId = null, generatedQuestionId = null, canonicalSubcategory } = input;
  if (!questionId && !generatedQuestionId) return;

  const existing = await db
    .select({ id: hiddenQuestions.id })
    .from(hiddenQuestions)
    .where(
      and(
        eq(hiddenQuestions.userId, userId),
        questionId
          ? eq(hiddenQuestions.questionId, questionId)
          : eq(hiddenQuestions.generatedQuestionId, generatedQuestionId as string),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(hiddenQuestions).values({
    userId,
    questionId,
    generatedQuestionId,
    canonicalSubcategory,
    hiddenAt: new Date(),
  });
}

/**
 * Un-hide — the undo behind "Hidden questions" in settings. Deletes the row
 * outright rather than tombstoning it, so the question returns to the pool and
 * can be hidden again later without special-casing a restored state.
 *
 * Scoped to the owning user, so a stray id can't clear someone else's row.
 */
export async function restoreHiddenQuestion(userId: string, hiddenId: string): Promise<boolean> {
  const deleted = await db
    .delete(hiddenQuestions)
    .where(and(eq(hiddenQuestions.id, hiddenId), eq(hiddenQuestions.userId, userId)))
    .returning({ id: hiddenQuestions.id });
  return deleted.length > 0;
}

export type HiddenQuestionRow = {
  id: string;
  questionText: string;
  domain: string;
  hiddenAt: Date;
};

/**
 * The player's hidden questions, newest first, with enough text to recognize
 * what they're restoring. Question text is resolved from whichever source the
 * row points at; a row whose question has since been deleted is skipped rather
 * than rendered as a blank line.
 */
export async function getHiddenQuestionsForUser(userId: string): Promise<HiddenQuestionRow[]> {
  const rows = await db
    .select({
      id: hiddenQuestions.id,
      questionId: hiddenQuestions.questionId,
      generatedQuestionId: hiddenQuestions.generatedQuestionId,
      domain: hiddenQuestions.canonicalSubcategory,
      hiddenAt: hiddenQuestions.hiddenAt,
    })
    .from(hiddenQuestions)
    .where(eq(hiddenQuestions.userId, userId))
    .orderBy(desc(hiddenQuestions.hiddenAt));

  if (rows.length === 0) return [];

  // Two batched lookups rather than a join per source — the row count here is
  // player-scale (tens), and this keeps the query count flat at two.
  const canonicalIds = rows.map((r) => r.questionId).filter((v): v is string => Boolean(v));
  const generatedIds = rows.map((r) => r.generatedQuestionId).filter((v): v is string => Boolean(v));

  const [canonicalRows, generatedRows] = await Promise.all([
    canonicalIds.length > 0
      ? db
          .select({ id: questions.id, text: questions.questionText })
          .from(questions)
          .where(inArray(questions.id, canonicalIds))
      : Promise.resolve([] as Array<{ id: string; text: string }>),
    generatedIds.length > 0
      ? db
          .select({ id: generatedQuestions.id, text: generatedQuestions.questionText })
          .from(generatedQuestions)
          .where(inArray(generatedQuestions.id, generatedIds))
      : Promise.resolve([] as Array<{ id: string; text: string }>),
  ]);

  const textById = new Map<string, string>();
  for (const row of canonicalRows) textById.set(row.id, row.text);
  for (const row of generatedRows) textById.set(row.id, row.text);

  const result: HiddenQuestionRow[] = [];
  for (const row of rows) {
    const key = row.questionId ?? row.generatedQuestionId;
    const questionText = key ? textById.get(key) : undefined;
    // A hidden question whose source row is gone has nothing to show and nothing
    // meaningful to restore — leave it out of the list.
    if (!questionText) continue;
    result.push({
      id: row.id,
      questionText,
      domain: row.domain,
      hiddenAt: row.hiddenAt,
    });
  }
  return result;
}
