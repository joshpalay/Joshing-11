import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db, feedDismissedDomains, feedItems, masteryEvents, questionFeedback, questionRatings, questions } from '@/server/db';
import { writeActivity } from '@/server/activity/write-activity';
import { getNicheMatchDiscoverable } from '@/server/db/queries/account';
import { getFollowers } from '@/server/db/queries/friends';
import { getRelationship } from '@/server/db/queries/friend-requests';
import { rollOffOldItems } from '@/server/db/queries/feed';
import { isCorrectAnswerFeedEligible, SOCIAL_FEED_SOURCE_TYPE } from '@/server/feed/visibility';

// Joshing-games funnel through this same after() entrypoint but stamp their
// sourceAnswerId with this prefix (see src/app/api/joshing-games/[id]/answer/
// route.ts). Niche-match discovery is explicitly EXCLUDED for them — a
// joshing-game is an invited context, not organic stranger discovery
// (D-2 spec §Q7) — so we detect and skip on this prefix.
const JOSHING_GAME_SOURCE_PREFIX = 'joshing_game:';

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

  // D-2 niche-match stranger discovery. Fires HERE — before the friend
  // fan-out's `friends.length === 0` early return below — because the core
  // atonal-stranger case (the one other person who knows your obscure corner)
  // has zero followers who share the niche, so it must run independent of the
  // friend-feed path. notifyNicheMatch owns its own try/catch so a niche
  // failure can't abort the friend fan-out that follows.
  await notifyNicheMatch(userId, questionId, question.creatorId, sourceAnswerId);

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

// D-2 niche-match: the stranger discovery loop. A correct answer to a question
// authored by a *stranger* surfaces each party to the other as an activity
// item — the notify-and-connect loop the engine is built on. Both writes are
// asymmetrically gated so identity is only ever exposed to a third party with
// the exposed party's own consent. See PRD-D-2-NICHE-MATCH-DISCOVERY-SPEC.md
// §"The notify-and-connect loop" / §"Gate direction".
//
// Exported for unit testing (the gate is correctness-critical — a mis-wire
// exposes people to strangers they didn't intend, doubly so under the
// test-phase DEFAULT-ON for discoverableByNicheMatch).
export async function notifyNicheMatch(
  answererId: string,
  questionId: string,
  creatorId: string | null,
  sourceAnswerId?: string,
): Promise<void> {
  try {
    // Excluded surface: joshing-games (invited context, not organic discovery).
    if (sourceAnswerId?.startsWith(JOSHING_GAME_SOURCE_PREFIX)) return;

    // Fire condition: a real human author who isn't the answerer. LLM-origin
    // questions (daily_generated / curated_sent) carry a null creatorId and so
    // never trigger niche-match — there is no author to discover.
    if (!creatorId || creatorId === answererId) return;

    // Fire condition: STRANGER gate. Only the 'none' relationship state
    // qualifies. Any approved-or-pending follow edge in either direction
    // (friends / following / follows_you / pending_outbound / pending_inbound)
    // means they are not strangers — friends already see each other through
    // friend_answered_your_question + Lately, so firing for them is noise.
    const relationship = await getRelationship(answererId, creatorId);
    if (relationship.state !== 'none') return;

    // Fire condition: the ASYMMETRIC two-flag gate. The flag of the party whose
    // identity a notification would EXPOSE gates that notification. Do NOT
    // invert this.
    const optedIn = await getNicheMatchDiscoverable([answererId, creatorId]);

    const writes: Array<Promise<void>> = [];

    // Author-side: tells the AUTHOR (creatorId) that a stranger — the answerer —
    // answered their question. It exposes the ANSWERER, so it is gated by the
    // ANSWERER's flag.
    if (optedIn.has(answererId)) {
      writes.push(writeActivity({
        userId: creatorId,
        type: 'niche_match_answered_your_question',
        actorUserId: answererId,
        referenceId: questionId,
        referenceType: 'question',
      }));
    }

    // Answerer-side: tells the ANSWERER that they answered a stranger's — the
    // author's — question. It exposes the AUTHOR, so it is gated by the
    // AUTHOR's flag.
    if (optedIn.has(creatorId)) {
      writes.push(writeActivity({
        userId: answererId,
        type: 'niche_match_you_answered',
        actorUserId: creatorId,
        referenceId: questionId,
        referenceType: 'question',
      }));
    }

    await Promise.all(writes);
  } catch (error) {
    console.error('[notifyNicheMatch] suppressed error:', {
      answererId,
      questionId,
      creatorId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
