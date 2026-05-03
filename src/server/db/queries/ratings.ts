import { and, count, eq, sql } from 'drizzle-orm';

import { db, questionRatings, questions } from '@/server/db';

export type QuestionRatingValue = 'up' | 'down';

export async function setRating(
  userId: string,
  questionId: string,
  rating: QuestionRatingValue | null,
): Promise<void> {
  if (rating === null) {
    await db
      .delete(questionRatings)
      .where(and(eq(questionRatings.userId, userId), eq(questionRatings.questionId, questionId)));
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

  if (rating === 'up') {
    // Thumbs-up is a quality signal — increment surface priority score
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
