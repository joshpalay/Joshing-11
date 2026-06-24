/**
 * One-time inviter feed backfill (B-HomeSeed-1, Part A).
 *
 * When the auto-friendship between an inviter and a brand-new user is formed at
 * signup completion (acceptFriendInvitation / acceptUserInviteLink, both via
 * upsertInvitationFriendship), seed the new user with the inviter's most recent
 * correctly-answered daily questions as real `friend_answered` feed items.
 *
 * Why this is honest under the current model: forward propagation only fires for
 * answers the inviter gives AFTER the follow edge exists. These rows reconstruct
 * exactly what WOULD have propagated had the two been friends when the inviter
 * answered — same source_type, same attribution, same true answer time. The D-1
 * "feed flip" means `friend_answered` rows no longer render as feed cards; they
 * are now the source signal for Lately milestones (getLatelyMilestones), so a
 * backfilled inviter surfaces in the unified "What's Happening" home feed as a
 * milestone line that expands to their literal answerable questions.
 *
 * NOT a reuse of createFeedItemsForFriendsFromAnswer: that helper fans out to ALL
 * of the answerer's followers and stamps sourceEventAt = now. Here we target the
 * one invitee and preserve the inviter's ORIGINAL answer time so Lately ordering
 * stays truthful. The row SHAPE (columns + source_type constant) is shared.
 *
 * The pure decision functions (pick / dedupe / build) are split from the DB I/O
 * so the cap, the empty case, and idempotency are unit-testable without a DB —
 * mirroring the deriveLatelyMilestones / getLatelyMilestones split.
 */

import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';

import { db, feedItems, masteryEvents, questions } from '@/server/db';
import { SOCIAL_FEED_SOURCE_TYPE } from '@/server/feed/visibility';

// The inviter's daily/catchup CORRECT answers are the seed. Both surfaces
// originate from the Daily Five queue (live = answered in the round, catchup =
// a previously-missed daily answered later), matching the LIVE_SOURCE_TYPES the
// Lately surfaces already key on.
const DAILY_SURFACE_SOURCE_TYPES = ['live_correct', 'catchup_correct'] as const;
const CORRECT_ANSWER_STATES = [
  'first_correct',
  'first_correct_after_wrong',
  'repeat_correct',
] as const;

// Most recent N of the inviter's correct daily answers, regardless of date.
export const INVITER_BACKFILL_MAX_ITEMS = 8;

// Over-read the inviter's mastery rows before per-question dedupe so a few
// repeat-correct rows can't starve us below the cap.
const MASTERY_SCAN_LIMIT = 200;

export type InviterAnswerRow = {
  masteryEventId: string;
  questionId: string;
  answeredAt: Date;
};

export type BackfillFeedItemRow = {
  recipientUserId: string;
  questionId: string;
  sourceType: typeof SOCIAL_FEED_SOURCE_TYPE;
  sourceUserId: string;
  sourceResult: 'correct';
  sourceEventAt: Date;
  sourceAnswerId: string;
  state: 'active';
  isPinned: false;
};

// Deterministic so a re-fire produces the SAME sourceAnswerId, colliding on the
// partial unique index FeedItem_recipientUserId_sourceAnswerId_key. Prefixed so
// it can never collide with a real answer id used by forward propagation.
export function backfillSourceAnswerId(masteryEventId: string): string {
  return `inviter-backfill:${masteryEventId}`;
}

// Dedupe by questionId (rows arrive newest-first, so the first occurrence is the
// most recent answer of that question), then keep the most recent `limit`
// distinct questions. Pure.
export function pickInviterBackfillAnswers(
  rows: InviterAnswerRow[],
  limit = INVITER_BACKFILL_MAX_ITEMS,
): InviterAnswerRow[] {
  const seen = new Set<string>();
  const picked: InviterAnswerRow[] = [];
  for (const row of rows) {
    if (!row.questionId || !row.answeredAt) continue;
    if (seen.has(row.questionId)) continue;
    seen.add(row.questionId);
    picked.push(row);
    if (picked.length >= limit) break;
  }
  return picked;
}

// Drop questions that already have a backfilled row from this source for this
// recipient, so a re-fire (or a race with forward propagation) is a no-op. Pure;
// generic over any row carrying a `questionId` (answer-seed or authored-seed).
export function dropAlreadyPresent<T extends { questionId: string }>(
  picked: T[],
  existingQuestionIds: Iterable<string>,
): T[] {
  const existing = new Set(existingQuestionIds);
  return picked.filter((row) => !existing.has(row.questionId));
}

// Build the feed-item insert rows. Same source_type + shape as the organic
// friend_answered path; sourceEventAt is the inviter's TRUE answer time. Pure.
export function toBackfillFeedItemRows(
  inviterUserId: string,
  inviteeUserId: string,
  picked: InviterAnswerRow[],
): BackfillFeedItemRow[] {
  return picked.map((row) => ({
    recipientUserId: inviteeUserId,
    questionId: row.questionId,
    sourceType: SOCIAL_FEED_SOURCE_TYPE,
    sourceUserId: inviterUserId,
    sourceResult: 'correct',
    sourceEventAt: row.answeredAt,
    sourceAnswerId: backfillSourceAnswerId(row.masteryEventId),
    state: 'active',
    isPinned: false,
  }));
}

/**
 * Backfill a follower's feed with the most recent correct daily/catchup answers
 * of someone they just started following (`answererUserId` = the followee whose
 * activity propagates, `recipientUserId` = the follower who now sees it).
 *
 * Honest under the forward-propagation model for the SAME reason the invite seed
 * is: forward propagation only fires for answers the answerer gives AFTER the
 * follow edge exists, so these rows reconstruct exactly what WOULD have
 * propagated had the edge existed when the answerer answered — same source_type,
 * same attribution, same true answer time. Used by both the invite auto-friendship
 * (B-HomeSeed-1) and a normal friend-add (an approved follow edge).
 *
 * Best-effort: any failure is swallowed so a backfill hiccup can never break
 * invitation acceptance, signup, or friend-request approval. Returns the number
 * of feed items created (0 when the answerer has no qualifying answers, or when
 * everything was already backfilled).
 */
export async function backfillFollowedUserFeedItems({
  answererUserId,
  recipientUserId,
  limit = INVITER_BACKFILL_MAX_ITEMS,
}: {
  answererUserId: string;
  recipientUserId: string;
  limit?: number;
}): Promise<{ created: number }> {
  try {
    if (!answererUserId || !recipientUserId || answererUserId === recipientUserId) {
      return { created: 0 };
    }

    // The answerer's correct daily/catchup answers, newest first, joined to a
    // feed-eligible question (public, not deleted, not authored by the recipient —
    // the milestone surface 403s "answer your own question", so don't seed it).
    const rows = await db
      .select({
        masteryEventId: masteryEvents.id,
        questionId: masteryEvents.questionId,
        answeredAt: masteryEvents.createdAt,
      })
      .from(masteryEvents)
      .innerJoin(questions, eq(questions.id, masteryEvents.questionId))
      .where(
        and(
          eq(masteryEvents.userId, answererUserId),
          inArray(masteryEvents.sourceType, DAILY_SURFACE_SOURCE_TYPES),
          inArray(masteryEvents.answerState, CORRECT_ANSWER_STATES),
          eq(questions.visibility, 'public'),
          isNull(questions.deletedAt),
          or(isNull(questions.creatorId), ne(questions.creatorId, recipientUserId)),
        ),
      )
      .orderBy(desc(masteryEvents.createdAt))
      .limit(MASTERY_SCAN_LIMIT);

    const answerRows: InviterAnswerRow[] = [];
    for (const row of rows) {
      if (!row.questionId || !row.answeredAt) continue;
      answerRows.push({
        masteryEventId: row.masteryEventId,
        questionId: row.questionId,
        answeredAt: row.answeredAt,
      });
    }

    const candidates = pickInviterBackfillAnswers(answerRows, limit);
    if (candidates.length === 0) return { created: 0 };

    const candidateQuestionIds = candidates.map((c) => c.questionId);
    const existing = await db
      .select({ questionId: feedItems.questionId })
      .from(feedItems)
      .where(
        and(
          eq(feedItems.recipientUserId, recipientUserId),
          eq(feedItems.sourceUserId, answererUserId),
          inArray(feedItems.questionId, candidateQuestionIds),
        ),
      );

    const toInsert = dropAlreadyPresent(
      candidates,
      existing.map((e) => e.questionId).filter((id): id is string => Boolean(id)),
    );
    if (toInsert.length === 0) return { created: 0 };

    await db.insert(feedItems).values(toBackfillFeedItemRows(answererUserId, recipientUserId, toInsert));

    return { created: toInsert.length };
  } catch (error) {
    console.error('[backfillFollowedUserFeedItems] suppressed error:', {
      answererUserId,
      recipientUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { created: 0 };
  }
}

// --- Authored-question backfill (B-HOME-FRIEND-REQUESTS follow-up) ------------
//
// When a mutual friendship forms, also seed each side's feed with the OTHER
// person's public authored questions, so a new friend's actual content shows up
// — not just their recent answers. These land as `authored_shared` rows (the
// same envelope question-creation's "share with all friends" writes), stamped at
// the question's ORIGINAL authored time so feed ordering stays truthful (product
// decision 2026-06-24: truthful authored-date over surfacing-at-accept-time).

const AUTHORED_SHARED_FEED_SOURCE_TYPE = 'authored_shared' as const;

// Most recent N of the friend's public authored questions, regardless of date.
export const AUTHORED_BACKFILL_MAX_ITEMS = 8;

// Over-read before the cap so the public/authored filter can't starve us.
const AUTHORED_SCAN_LIMIT = 100;

export type AuthoredQuestionRow = {
  questionId: string;
  authoredAt: Date;
};

export type AuthoredBackfillFeedItemRow = {
  recipientUserId: string;
  questionId: string;
  sourceType: typeof AUTHORED_SHARED_FEED_SOURCE_TYPE;
  sourceUserId: string;
  sourceResult: null;
  sourceEventAt: Date;
  sourceAnswerId: string;
  state: 'active';
  isPinned: false;
};

// Deterministic + prefixed so a re-fire collides on
// FeedItem_recipientUserId_sourceAnswerId_key and can never collide with a real
// answer id or the inviter-backfill answer seed.
export function authoredBackfillSourceAnswerId(questionId: string): string {
  return `authored-backfill:${questionId}`;
}

// Dedupe by questionId (rows arrive newest-first) and keep the most recent
// `limit` distinct questions. Pure.
export function pickAuthoredBackfillQuestions(
  rows: AuthoredQuestionRow[],
  limit = AUTHORED_BACKFILL_MAX_ITEMS,
): AuthoredQuestionRow[] {
  const seen = new Set<string>();
  const picked: AuthoredQuestionRow[] = [];
  for (const row of rows) {
    if (!row.questionId || !row.authoredAt) continue;
    if (seen.has(row.questionId)) continue;
    seen.add(row.questionId);
    picked.push(row);
    if (picked.length >= limit) break;
  }
  return picked;
}

// Build the authored_shared insert rows. sourceEventAt is the question's TRUE
// authored time; sourceResult is null (no answer is involved). Pure.
export function toAuthoredBackfillFeedItemRows(
  authorUserId: string,
  recipientUserId: string,
  picked: AuthoredQuestionRow[],
): AuthoredBackfillFeedItemRow[] {
  return picked.map((row) => ({
    recipientUserId,
    questionId: row.questionId,
    sourceType: AUTHORED_SHARED_FEED_SOURCE_TYPE,
    sourceUserId: authorUserId,
    sourceResult: null,
    sourceEventAt: row.authoredAt,
    sourceAnswerId: authoredBackfillSourceAnswerId(row.questionId),
    state: 'active',
    isPinned: false,
  }));
}

/**
 * Backfill a recipient's feed with a friend's most recent PUBLIC authored
 * questions (`authorUserId` = the friend whose questions seed the feed,
 * `recipientUserId` = the friend who now sees them). Only `visibility: 'public'`,
 * `source: 'authored'`, non-deleted questions are eligible — a question the
 * author kept private is never surfaced.
 *
 * Best-effort: any failure is swallowed so a backfill hiccup can never break
 * friend-request approval. Returns the number of feed items created (0 when the
 * author has no qualifying questions, or when everything was already present).
 */
export async function backfillAuthoredQuestionsFeedItems({
  authorUserId,
  recipientUserId,
  limit = AUTHORED_BACKFILL_MAX_ITEMS,
}: {
  authorUserId: string;
  recipientUserId: string;
  limit?: number;
}): Promise<{ created: number }> {
  try {
    if (!authorUserId || !recipientUserId || authorUserId === recipientUserId) {
      return { created: 0 };
    }

    const rows = await db
      .select({ id: questions.id, createdAt: questions.createdAt })
      .from(questions)
      .where(
        and(
          eq(questions.creatorId, authorUserId),
          eq(questions.source, 'authored'),
          eq(questions.visibility, 'public'),
          isNull(questions.deletedAt),
        ),
      )
      .orderBy(desc(questions.createdAt))
      .limit(AUTHORED_SCAN_LIMIT);

    const authoredRows: AuthoredQuestionRow[] = [];
    for (const row of rows) {
      if (!row.id || !row.createdAt) continue;
      authoredRows.push({ questionId: row.id, authoredAt: row.createdAt });
    }

    const candidates = pickAuthoredBackfillQuestions(authoredRows, limit);
    if (candidates.length === 0) return { created: 0 };

    const candidateQuestionIds = candidates.map((c) => c.questionId);
    const existing = await db
      .select({ questionId: feedItems.questionId })
      .from(feedItems)
      .where(
        and(
          eq(feedItems.recipientUserId, recipientUserId),
          eq(feedItems.sourceUserId, authorUserId),
          eq(feedItems.sourceType, AUTHORED_SHARED_FEED_SOURCE_TYPE),
          inArray(feedItems.questionId, candidateQuestionIds),
        ),
      );

    const toInsert = dropAlreadyPresent(
      candidates,
      existing.map((e) => e.questionId).filter((id): id is string => Boolean(id)),
    );
    if (toInsert.length === 0) return { created: 0 };

    await db
      .insert(feedItems)
      .values(toAuthoredBackfillFeedItemRows(authorUserId, recipientUserId, toInsert));

    return { created: toInsert.length };
  } catch (error) {
    console.error('[backfillAuthoredQuestionsFeedItems] suppressed error:', {
      authorUserId,
      recipientUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { created: 0 };
  }
}

/**
 * Inviter-only, one-time backfill (B-HomeSeed-1). Thin alias over
 * backfillFollowedUserFeedItems preserving the invite call sites' naming: the
 * inviter is the answerer whose activity seeds the new invitee's feed.
 */
export async function backfillInviterFeedItems({
  inviterUserId,
  inviteeUserId,
  limit = INVITER_BACKFILL_MAX_ITEMS,
}: {
  inviterUserId: string;
  inviteeUserId: string;
  limit?: number;
}): Promise<{ created: number }> {
  return backfillFollowedUserFeedItems({
    answererUserId: inviterUserId,
    recipientUserId: inviteeUserId,
    limit,
  });
}
