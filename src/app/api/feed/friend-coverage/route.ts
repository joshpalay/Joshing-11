import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  db,
  feedDismissedDomains,
  feedItems,
  follows,
  masteryEvents,
  questionFeedback,
  questionRatings,
  questions,
  users,
} from '@/server/db';
import { isCorrectAnswerFeedEligible } from '@/server/feed/visibility';

export const dynamic = 'force-dynamic';

export type FriendCoverageDiagnosis =
  | 'visible'
  | 'friendship_inactive'
  | 'eligibility_failed'
  | 'friend_thumbs_down'
  | 'domain_dismissed_by_viewer'
  | 'no_feed_item_written'
  | 'feed_item_state_hidden'
  | 'source_result_wrong'
  | 'rolled_off'
  | 'question_now_private_or_deleted';

export type FriendCoverageEventRow = {
  masteryEventId: string;
  masteryAnswerId: string | null;
  masterySourceType: 'live_correct' | 'catchup_correct';
  masteryAnswerState: string | null;
  answeredAt: string;
  questionId: string | null;
  questionTextSnippet: string | null;
  questionVisibility: string | null;
  questionSource: string | null;
  questionDeletedAt: string | null;
  questionCreatorId: string | null;
  questionCanonicalSubcategory: string | null;
  questionBroadCategory: string | null;
  eligibilityWouldPass: boolean;
  friendThumbsDown: boolean;
  viewerDomainDismissed: boolean;
  feedItem: {
    id: string;
    state: string;
    sourceType: string;
    sourceResult: 'correct' | 'incorrect' | null;
    sourceEventAt: string;
    sourceAnswerId: string | null;
    isPinned: boolean;
    createdAt: string;
  } | null;
  diagnosis: FriendCoverageDiagnosis;
};

export type FriendCoverageFriendBlock = {
  friendUserId: string;
  friendDisplayName: string | null;
  friendPhoneNumber: string | null;
  friendshipId: string | null;
  friendshipStatus: string | null;
  recentCorrectAnswers: FriendCoverageEventRow[];
  note: string | null;
};

export type FriendCoverageResponse = {
  viewerUserId: string;
  friendQuery: string | null;
  limit: number;
  summary: {
    totalFriendshipsForViewer: number;
    activeFriendCount: number;
    viewerActiveFeedItemCount: number;
    rolloffCap: number;
  };
  friends: FriendCoverageFriendBlock[];
};

const VISIBLE_FEED_STATES = new Set(['active', 'skipped', 'answered']);
const ACTION_REQUIRED_FEED_STATES = ['active', 'skipped'] as const;
const ROLLOFF_CAP = 50;

function isFeedDebugEnabled() {
  if (process.env.FEED_DEBUG_ENABLED === 'true') return true;
  if (process.env.NODE_ENV !== 'production') return true;
  // Vercel preview deploys run with NODE_ENV='production' but VERCEL_ENV='preview'.
  // Auto-enable there so the route is reachable without flipping a flag for every preview.
  return process.env.VERCEL_ENV !== undefined && process.env.VERCEL_ENV !== 'production';
}

function snippet(text: string | null | undefined, max = 120): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function loadFriendCoverage(
  viewerUserId: string,
  friendQuery: string | null,
  limit: number,
): Promise<FriendCoverageResponse> {
  // Follow model (D-1 Stage 3): a "friend" is a mutual follow. Build the
  // per-other map from approved/pending follow edges in both directions.
  const followEdges = await db
    .select({
      id: follows.id,
      followerId: follows.followerId,
      followeeId: follows.followeeId,
      state: follows.state,
    })
    .from(follows)
    .where(or(
      eq(follows.followerId, viewerUserId),
      eq(follows.followeeId, viewerUserId),
    ));

  const outboundByOther = new Map<string, { id: string; state: string }>();
  const inboundStateByOther = new Map<string, string>();
  for (const edge of followEdges) {
    if (edge.followerId === viewerUserId) {
      outboundByOther.set(edge.followeeId, { id: edge.id, state: edge.state });
    } else {
      inboundStateByOther.set(edge.followerId, edge.state);
    }
  }

  const otherIdsSet = new Set<string>([...outboundByOther.keys(), ...inboundStateByOther.keys()]);
  const friendshipByOtherUserId = new Map<string, { friendshipId: string | null; status: string }>();
  for (const otherId of otherIdsSet) {
    const outbound = outboundByOther.get(otherId);
    const mutual = outbound?.state === 'approved' && inboundStateByOther.get(otherId) === 'approved';
    friendshipByOtherUserId.set(otherId, {
      friendshipId: outbound?.id ?? null,
      status: mutual ? 'active' : 'pending',
    });
  }

  const activeFriendCount = [...friendshipByOtherUserId.values()].filter((f) => f.status === 'active').length;

  const viewerActiveFeedItemCount = await db
    .select({ value: sql<number>`COUNT(*)::int`.as('value') })
    .from(feedItems)
    .where(and(
      eq(feedItems.recipientUserId, viewerUserId),
      eq(feedItems.isPinned, false),
      inArray(feedItems.state, ACTION_REQUIRED_FEED_STATES),
    ))
    .then((rows) => rows[0]?.value ?? 0);

  const summary = {
    totalFriendshipsForViewer: otherIdsSet.size,
    activeFriendCount,
    viewerActiveFeedItemCount,
    rolloffCap: ROLLOFF_CAP,
  };

  const otherIds = [...friendshipByOtherUserId.keys()];
  if (otherIds.length === 0) {
    return { viewerUserId, friendQuery, limit, summary, friends: [] };
  }

  const friendFilters = [inArray(users.id, otherIds)];
  if (friendQuery) {
    friendFilters.push(or(
      eq(users.id, friendQuery),
      eq(users.phoneNumber, friendQuery),
      ilike(users.displayName, `%${friendQuery}%`),
    )!);
  }

  const friendRows = await db
    .select({ id: users.id, displayName: users.displayName, phoneNumber: users.phoneNumber })
    .from(users)
    .where(and(...friendFilters));

  if (friendRows.length === 0) {
    return { viewerUserId, friendQuery, limit, summary, friends: [] };
  }

  const viewerDismissedDomains = new Set(
    (await db
      .select({ canonicalSubcategory: feedDismissedDomains.canonicalSubcategory })
      .from(feedDismissedDomains)
      .where(and(
        eq(feedDismissedDomains.userId, viewerUserId),
        isNull(feedDismissedDomains.reinstatedAt),
      )))
      .map((row) => row.canonicalSubcategory),
  );

  const friends: FriendCoverageFriendBlock[] = [];

  for (const friend of friendRows) {
    const friendship = friendshipByOtherUserId.get(friend.id) ?? null;

    const events = await db
      .select({
        masteryEventId: masteryEvents.id,
        masteryAnswerId: masteryEvents.answerId,
        masterySourceType: masteryEvents.sourceType,
        masteryAnswerState: masteryEvents.answerState,
        answeredAt: masteryEvents.createdAt,
        questionId: questions.id,
        questionText: questions.questionText,
        questionVisibility: questions.visibility,
        questionSource: questions.source,
        questionDeletedAt: questions.deletedAt,
        questionCreatorId: questions.creatorId,
        questionCanonicalSubcategory: questions.canonicalSubcategory,
        questionBroadCategory: questions.broadCategory,
      })
      .from(masteryEvents)
      .leftJoin(questions, eq(masteryEvents.questionId, questions.id))
      .where(and(
        eq(masteryEvents.answeredByUserId, friend.id),
        inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
        inArray(masteryEvents.answerState, ['first_correct', 'first_correct_after_wrong', 'repeat_correct']),
      ))
      .orderBy(desc(masteryEvents.createdAt))
      .limit(limit);

    const rows: FriendCoverageEventRow[] = [];

    for (const event of events) {
      const questionPayload = event.questionId ? {
        creatorId: event.questionCreatorId,
        source: event.questionSource as 'authored' | 'daily_generated' | 'curated_sent',
        visibility: event.questionVisibility as 'public' | 'private',
        deletedAt: event.questionDeletedAt,
      } : null;

      const eligibilityWouldPass = questionPayload
        ? isCorrectAnswerFeedEligible({
          answerIsCorrect: true,
          answererUserId: friend.id,
          question: questionPayload,
          hasVisibleSocialContext: true,
        })
        : false;

      const [thumbsDownFeedback] = event.questionId ? await db
        .select({ id: questionFeedback.id })
        .from(questionFeedback)
        .where(and(
          eq(questionFeedback.userId, friend.id),
          eq(questionFeedback.questionId, event.questionId),
          eq(questionFeedback.signal, 'thumbs_down'),
        ))
        .limit(1) : [];

      const [thumbsDownRating] = event.questionId && !thumbsDownFeedback ? await db
        .select({ id: questionRatings.id })
        .from(questionRatings)
        .where(and(
          eq(questionRatings.userId, friend.id),
          eq(questionRatings.questionId, event.questionId),
          eq(questionRatings.rating, 'down'),
        ))
        .limit(1) : [];

      const friendThumbsDown = Boolean(thumbsDownFeedback || thumbsDownRating);

      const viewerDomainDismissed = Boolean(
        event.questionCanonicalSubcategory && viewerDismissedDomains.has(event.questionCanonicalSubcategory),
      );

      const feedItemRow = event.questionId ? await db
        .select()
        .from(feedItems)
        .where(and(
          eq(feedItems.recipientUserId, viewerUserId),
          eq(feedItems.questionId, event.questionId),
          eq(feedItems.sourceUserId, friend.id),
        ))
        .orderBy(desc(feedItems.sourceEventAt), desc(feedItems.id))
        .limit(1)
        .then((rs) => rs[0] ?? null) : null;

      let diagnosis: FriendCoverageDiagnosis;
      if (!friendship || friendship.status !== 'active') {
        diagnosis = 'friendship_inactive';
      } else if (!eligibilityWouldPass) {
        diagnosis = 'eligibility_failed';
      } else if (friendThumbsDown) {
        diagnosis = 'friend_thumbs_down';
      } else if (!feedItemRow) {
        diagnosis = viewerDomainDismissed ? 'domain_dismissed_by_viewer' : 'no_feed_item_written';
      } else if (feedItemRow.sourceResult !== 'correct') {
        diagnosis = 'source_result_wrong';
      } else if (feedItemRow.state === 'rolled_off') {
        diagnosis = 'rolled_off';
      } else if (!VISIBLE_FEED_STATES.has(feedItemRow.state)) {
        diagnosis = 'feed_item_state_hidden';
      } else if (questionPayload && ((questionPayload.visibility as string) !== 'public' || questionPayload.deletedAt)) {
        diagnosis = 'question_now_private_or_deleted';
      } else if (viewerDomainDismissed) {
        // Read-side filter excludes dismissed-domain rows even if the row exists.
        diagnosis = 'domain_dismissed_by_viewer';
      } else {
        diagnosis = 'visible';
      }

      rows.push({
        masteryEventId: event.masteryEventId,
        masteryAnswerId: event.masteryAnswerId,
        masterySourceType: event.masterySourceType as 'live_correct' | 'catchup_correct',
        masteryAnswerState: event.masteryAnswerState,
        answeredAt: isoOrNull(event.answeredAt) ?? '',
        questionId: event.questionId,
        questionTextSnippet: snippet(event.questionText),
        questionVisibility: event.questionVisibility,
        questionSource: event.questionSource,
        questionDeletedAt: isoOrNull(event.questionDeletedAt),
        questionCreatorId: event.questionCreatorId,
        questionCanonicalSubcategory: event.questionCanonicalSubcategory,
        questionBroadCategory: event.questionBroadCategory,
        eligibilityWouldPass,
        friendThumbsDown,
        viewerDomainDismissed,
        feedItem: feedItemRow ? {
          id: feedItemRow.id,
          state: feedItemRow.state,
          sourceType: feedItemRow.sourceType,
          sourceResult: feedItemRow.sourceResult,
          sourceEventAt: isoOrNull(feedItemRow.sourceEventAt) ?? '',
          sourceAnswerId: feedItemRow.sourceAnswerId,
          isPinned: feedItemRow.isPinned,
          createdAt: isoOrNull(feedItemRow.createdAt) ?? '',
        } : null,
        diagnosis,
      });
    }

    friends.push({
      friendUserId: friend.id,
      friendDisplayName: friend.displayName,
      friendPhoneNumber: friend.phoneNumber,
      friendshipId: friendship?.friendshipId ?? null,
      friendshipStatus: friendship?.status ?? null,
      recentCorrectAnswers: rows,
      note: rows.length === 0 ? 'No recent correct daily/catchup answers found in masteryEvents.' : null,
    });
  }

  return { viewerUserId, friendQuery, limit, summary, friends };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isFeedDebugEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const friendQuery = request.nextUrl.searchParams.get('friend')?.trim() || null;
  const rawLimit = Number(request.nextUrl.searchParams.get('limit') ?? '25');
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 25, 1), 100);

  const payload = await loadFriendCoverage(session.userId, friendQuery, limit);
  return NextResponse.json(payload);
}

export const __test_only_isFeedDebugEnabled = isFeedDebugEnabled;
