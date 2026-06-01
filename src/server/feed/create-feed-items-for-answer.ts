import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db, feedDismissedDomains, feedItems, masteryEvents, questionFeedback, questionRatings, questions } from '@/server/db';
import { writeActivity } from '@/server/activity/write-activity';
import { getFollowers } from '@/server/db/queries/friends';
import { rollOffOldItems } from '@/server/db/queries/feed';
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
    .select({
      creatorId: questions.creatorId,
      source: questions.source,
      visibility: questions.visibility,
      deletedAt: questions.deletedAt,
      canonicalSubcategory: questions.canonicalSubcategory,
      broadCategory: questions.broadCategory,
    })
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

  // friend_answered fan-out reaches my followers — people who follow me see
  // that I answered correctly (directional follow model, D-1 Stage 3).
  const friends = await getFollowers(userId);
  if (friends.length === 0) {
    await notifyPreviousAnswerers(userId, questionId);
    return;
  }

  const friendIds = friends.map((f) => f.id);

  // Batched eligibility checks — one set-based query per filter instead of N
  // sequential round-trips per friend.
  const [dismissedRows, existingRows, answerEventRows, alreadyAnsweredRows] = await Promise.all([
    db
      .select({ userId: feedDismissedDomains.userId })
      .from(feedDismissedDomains)
      .where(and(
        inArray(feedDismissedDomains.userId, friendIds),
        eq(feedDismissedDomains.canonicalSubcategory, domain),
        isNull(feedDismissedDomains.reinstatedAt),
      )),
    db
      .select({ recipientUserId: feedItems.recipientUserId })
      .from(feedItems)
      .where(and(
        inArray(feedItems.recipientUserId, friendIds),
        eq(feedItems.questionId, questionId),
        eq(feedItems.sourceUserId, userId),
      )),
    sourceAnswerId
      ? db
          .select({ recipientUserId: feedItems.recipientUserId })
          .from(feedItems)
          .where(and(
            inArray(feedItems.recipientUserId, friendIds),
            eq(feedItems.sourceAnswerId, sourceAnswerId),
          ))
      : Promise.resolve([] as Array<{ recipientUserId: string }>),
    // Skip recipients who already answered this question on any surface
    // (their own daily, catchup, or an earlier feed item). Without this,
    // Robyn answers her declared-interest question in the daily, Josh later
    // answers the same canonical question, and Robyn gets a fresh "Josh
    // answered — your turn" feed card for content she already knows.
    db
      .select({ userId: masteryEvents.userId })
      .from(masteryEvents)
      .where(and(
        inArray(masteryEvents.userId, friendIds),
        eq(masteryEvents.questionId, questionId),
        inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
      )),
  ]);

  const dismissedSet = new Set(dismissedRows.map((r) => r.userId));
  const existingSet = new Set(existingRows.map((r) => r.recipientUserId));
  const answerEventSet = new Set(answerEventRows.map((r) => r.recipientUserId));
  const alreadyAnsweredSet = new Set(alreadyAnsweredRows.map((r) => r.userId));

  const eligibleRecipientIds = friendIds.filter(
    (id) =>
      !dismissedSet.has(id)
      && !existingSet.has(id)
      && !answerEventSet.has(id)
      && !alreadyAnsweredSet.has(id),
  );

  if (eligibleRecipientIds.length > 0) {
    const eventAt = new Date();
    await db.insert(feedItems).values(
      eligibleRecipientIds.map((recipientId) => ({
        recipientUserId: recipientId,
        questionId,
        sourceType: SOCIAL_FEED_SOURCE_TYPE,
        sourceUserId: userId,
        sourceResult: result,
        sourceEventAt: eventAt,
        sourceAnswerId,
        state: 'active',
        isPinned: false,
      })),
    );

    // rollOff stays per-recipient (it's keyed on a per-user "first 50" window)
    // but runs in parallel rather than sequentially.
    await Promise.all(eligibleRecipientIds.map((id) => rollOffOldItems(id)));
  }

  await notifyPreviousAnswerers(userId, questionId);
}

async function notifyPreviousAnswerers(userId: string, questionId: string): Promise<void> {
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
