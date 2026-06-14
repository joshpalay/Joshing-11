import { and, count, eq, sql } from 'drizzle-orm';

import { db, questionFeedback, questionRatings, questions } from '@/server/db';

export type QuestionRatingValue = 'up' | 'down';

/**
 * Feed thumbs-up: record the quality signal once per (user, question) — the
 * QuestionFeedback unique key dedupes — and bump surfacePriorityScore only
 * when the signal is newly recorded, so repeat taps are no-ops (matching
 * setRating's previous-rating idempotency below). This is the ONLY feed-side
 * surfacePriorityScore write; keep it next to setRating's so the two paths
 * can't drift. The score itself is write-only today: thumbs-up → ordering is
 * an open product decision (DECISIONS.md "Thumbs-up → surface priority").
 */
export async function recordFeedThumbsUp(userId: string, questionId: string): Promise<void> {
  const inserted = await db
    .insert(questionFeedback)
    .values({ userId, questionId, signal: 'thumbs_up' })
    .onConflictDoNothing()
    .returning({ id: questionFeedback.id });

  if (inserted.length === 0) return;

  await db
    .update(questions)
    .set({ surfacePriorityScore: sql`${questions.surfacePriorityScore} + 1` })
    .where(eq(questions.id, questionId));
}

// Writes are up-only: the thumbs-down UI was retired in favour of the structured
// content-report flow, so the API no longer accepts 'down' (see the rating route).
// Reads (getRatingForUser / getRatingCounts) still surface historical 'down' rows.
export async function setRating(
  userId: string,
  questionId: string,
  rating: 'up' | null,
): Promise<void> {
  const [existing] = await db
    .select({ rating: questionRatings.rating })
    .from(questionRatings)
    .where(and(eq(questionRatings.userId, userId), eq(questionRatings.questionId, questionId)))
    .limit(1);

  const previousRating = existing?.rating ?? null;

  if (rating === null) {
    await db
      .delete(questionRatings)
      .where(and(eq(questionRatings.userId, userId), eq(questionRatings.questionId, questionId)));
    if (previousRating === 'up') {
      await db
        .update(questions)
        .set({ surfacePriorityScore: sql`${questions.surfacePriorityScore} - 1` })
        .where(eq(questions.id, questionId));
    }
    return;
  }

  await db
    .insert(questionRatings)
    .values({ userId, questionId, rating })
    .onConflictDoUpdate({
      target: [questionRatings.userId, questionRatings.questionId],
      set: {
        rating,
        createdAt: new Date(),
      },
    });

  // rating is 'up' here (null returned above); only a newly-recorded up bumps the score.
  if (previousRating !== 'up') {
    await db
      .update(questions)
      .set({ surfacePriorityScore: sql`${questions.surfacePriorityScore} + 1` })
      .where(eq(questions.id, questionId));
  }
}

export async function getRatingForUser(
  userId: string,
  questionId: string,
): Promise<QuestionRatingValue | null> {
  const [row] = await db
    .select({ rating: questionRatings.rating })
    .from(questionRatings)
    .where(and(eq(questionRatings.userId, userId), eq(questionRatings.questionId, questionId)))
    .limit(1);

  return row?.rating === 'up' || row?.rating === 'down' ? row.rating : null;
}

export async function getRatingCounts(questionId: string): Promise<{ up: number; down: number }> {
  const rows = await db
    .select({
      rating: questionRatings.rating,
      value: count(),
    })
    .from(questionRatings)
    .where(eq(questionRatings.questionId, questionId))
    .groupBy(questionRatings.rating);

  return {
    up: rows.find((row) => row.rating === 'up')?.value ?? 0,
    down: rows.find((row) => row.rating === 'down')?.value ?? 0,
  };
}
