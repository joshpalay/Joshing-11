import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db, feedDismissedDomains, feedItems, masteryEvents, questionFeedback, questionRatings, questions } from '@/server/db';
import { writeActivity } from '@/server/activity/write-activity';
import { getFriends } from '@/server/db/queries/friends';
import { rollOffOldItems, userAnsweredQuestionCorrectly } from '@/server/db/queries/feed';
import { isCorrectAnswerFeedEligible, SOCIAL_FEED_SOURCE_TYPE } from '@/server/feed/visibility';

export async function createFeedItemsForFriendsFromAnswer(
  userId: string,
  questionId: string,
  result: 'correct' | 'incorrect',
  sourceAnswerId?: string,
): Promise<void> {
  try {
    await _createFeedItemsForFriendsFromAnswer(userId, questionId, result, sourceAnswerId);
  } catch (error) {
    console.error('[createFeedItemsForFriendsFromAnswer] propagation error (suppressed):', {
      userId,
      questionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function _createFeedItemsForFriendsFromAnswer(
  userId: string,
  questionId: string,
  result: 'correct' | 'incorrect',
  sourceAnswerId?: string,
): Promise<void> {
  if (result !== 'correct') return;

  // Don't propagate if the answering user thumbed this question down via either signal path
  const [thumbsDown] = await db
    .select({ id: questionFeedback.id })
    .from(questionFeedback)
    .where(and(
      eq(questionFeedback.userId, userId),
      eq(questionFeedback.questionId, questionId),
      eq(questionFeedback.signal, 'thumbs_down'),
    ))
    .limit(1);

  const [ratingDown] = thumbsDown ? [] : await db
    .select({ id: questionRatings.id })
    .from(questionRatings)
    .where(and(
      eq(questionRatings.userId, userId),
      eq(questionRatings.questionId, questionId),
      eq(questionRatings.rating, 'down'),
    ))
    .limit(1);

  if (thumbsDown || ratingDown) return;

  const [question] = await db
    .select({ creatorId: questions.creatorId, visibility: questions.visibility, deletedAt: questions.deletedAt, canonicalSubcategory: questions.canonicalSubcategory, broadCategory: questions.broadCategory })
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);

  if (!isCorrectAnswerFeedEligible({
    answerIsCorrect: result === 'correct',
    answererUserId: userId,
    question,
    hasVisibleSocialContext: true,
  })) return;

  const domain = question.canonicalSubcategory ?? question.broadCategory;
  if (!domain) return;

  const friends = await getFriends(userId);
  if (friends.length === 0) return;

  for (const friend of friends) {
    const alreadyCorrect = await userAnsweredQuestionCorrectly(friend.id, questionId);
    if (alreadyCorrect) continue;

    // Skip if friend has dismissed this domain
    const [dismissed] = await db
      .select({ id: feedDismissedDomains.id })
      .from(feedDismissedDomains)
      .where(and(
        eq(feedDismissedDomains.userId, friend.id),
        eq(feedDismissedDomains.canonicalSubcategory, domain),
        isNull(feedDismissedDomains.reinstatedAt),
      ))
      .limit(1);

    if (dismissed) continue;

    // Idempotency: skip if this exact source user already created an item for this friend+question
    const [existing] = await db
      .select({ id: feedItems.id })
      .from(feedItems)
      .where(and(
        eq(feedItems.recipientUserId, friend.id),
        eq(feedItems.questionId, questionId),
        eq(feedItems.sourceUserId, userId),
      ))
      .limit(1);

    if (existing) continue;

    if (sourceAnswerId) {
      const [answerEvent] = await db
        .select({ id: feedItems.id })
        .from(feedItems)
        .where(and(
          eq(feedItems.recipientUserId, friend.id),
          eq(feedItems.sourceAnswerId, sourceAnswerId),
        ))
        .limit(1);

      if (answerEvent) continue;
    }

    await db.insert(feedItems).values({
      recipientUserId: friend.id,
      questionId,
      sourceType: SOCIAL_FEED_SOURCE_TYPE,
      sourceUserId: userId,
      sourceResult: result,
      sourceEventAt: new Date(),
      sourceAnswerId,
      state: 'active',
      isPinned: false,
    });

    await rollOffOldItems(friend.id);
  }

  // Notify users who previously answered this question (Activity tab)
  const previousAnswerers = await db
    .select({ userId: masteryEvents.userId })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.questionId, questionId),
      eq(masteryEvents.answeredByUserId, masteryEvents.userId),
      inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
    ));

  const notifyIds = [...new Set(
    previousAnswerers.map((e) => e.userId).filter((id) => id !== userId),
  )];

  await Promise.all(notifyIds.map((prevUserId) =>
    writeActivity({
      userId: prevUserId,
      type: 'friend_answered_your_question',
      actorUserId: userId,
      referenceId: questionId,
      referenceType: 'question',
    }),
  ));
}
