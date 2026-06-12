import { and, count, eq, inArray, sql } from 'drizzle-orm';

import { db, feedItems, questionFeedback, questionRatings, questions } from '@/server/db';

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

export async function setRating(
  userId: string,
  questionId: string,
  rating: QuestionRatingValue | null,
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

  if (rating === 'up' && previousRating !== 'up') {
    await db
      .update(questions)
      .set({ surfacePriorityScore: sql`${questions.surfacePriorityScore} + 1` })
      .where(eq(questions.id, questionId));
  } else if (rating !== 'up' && previousRating === 'up') {
    await db
      .update(questions)
      .set({ surfacePriorityScore: sql`${questions.surfacePriorityScore} - 1` })
      .where(eq(questions.id, questionId));
  }

  if (rating === 'down') {
    // Soft-delete all FeedItems this user propagated from their answer (rolls them off friends' feeds)
    const propagated = await db
      .select({ id: feedItems.id })
      .from(feedItems)
      .where(and(
        eq(feedItems.sourceUserId, userId),
        eq(feedItems.questionId, questionId),
        inArray(feedItems.state, ['active', 'skipped']),
      ));

    if (propagated.length > 0) {
      await db
        .update(feedItems)
        .set({ state: 'rolled_off' })
        .where(inArray(feedItems.id, propagated.map((r) => r.id)));
    }

    // Also soft-delete the user's own FeedItem for this question
    const ownItems = await db
      .select({ id: feedItems.id })
      .from(feedItems)
      .where(and(
        eq(feedItems.recipientUserId, userId),
        eq(feedItems.questionId, questionId),
        inArray(feedItems.state, ['active', 'skipped']),
      ));

    if (ownItems.length > 0) {
      await db
        .update(feedItems)
        .set({ state: 'rolled_off' })
        .where(inArray(feedItems.id, ownItems.map((r) => r.id)));
    }
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
