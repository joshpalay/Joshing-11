import { and, count, eq, inArray, ne, sql } from 'drizzle-orm';

import { db, feedItems, joshingGameResponses, masteryEvents, questionRatings, users } from '@/server/db';
import { rollOffOldItems } from '@/server/db/queries/feed';

export type QuestionRatingValue = 'up' | 'down';

async function createThumbsUpFeedItems(userId: string, questionId: string) {
  const [candidateUsers, correctResponses, correctMasteryEvents, existingItems] = await Promise.all([
    db
      .select({ id: users.id })
      .from(users)
      .where(ne(users.id, userId)),
    db
      .select({ userId: joshingGameResponses.userId })
      .from(joshingGameResponses)
      .where(and(
        eq(joshingGameResponses.questionId, questionId),
        eq(joshingGameResponses.isCorrect, true),
      )),
    db
      .select({ userId: masteryEvents.userId })
      .from(masteryEvents)
      .where(and(
        eq(masteryEvents.questionId, questionId),
        eq(masteryEvents.answeredByUserId, masteryEvents.userId),
        inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
        sql`${masteryEvents.awardedPoints} > 0`,
      )),
    db
      .select({ recipientUserId: feedItems.recipientUserId })
      .from(feedItems)
      .where(eq(feedItems.questionId, questionId)),
  ]);

  const correctUserIds = new Set([
    ...correctResponses.map((response) => response.userId),
    ...correctMasteryEvents.map((event) => event.userId),
  ]);
  const existingRecipientIds = new Set(existingItems.map((item) => item.recipientUserId));
  const recipientUserIds = candidateUsers
    .map((user) => user.id)
    .filter((recipientUserId) => !correctUserIds.has(recipientUserId) && !existingRecipientIds.has(recipientUserId));

  if (recipientUserIds.length === 0) return;

  await db.insert(feedItems).values(
    recipientUserIds.map((recipientUserId) => ({
      recipientUserId,
      questionId,
      sourceType: 'thumbs_upped',
      sourceUserId: userId,
      sourceEventAt: new Date(),
      state: 'active',
      isPinned: false,
    })),
  );

  await Promise.all(recipientUserIds.map((recipientUserId) => rollOffOldItems(recipientUserId)));
}

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
    await createThumbsUpFeedItems(userId, questionId);
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
