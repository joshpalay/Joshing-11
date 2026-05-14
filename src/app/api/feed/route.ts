import { and, count, eq, inArray, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, feedItems, friendships, questions, users } from '@/server/db';
import { checkBankedQuestions } from '@/server/db/queries/bank';
import { getDismissedDomains, getFeedForUser, visibleFeedSourcePredicate, type CollapsedFeedItem, type FeedCursor } from '@/server/db/queries/feed';
import { AUTHORED_SHARED_FEED_SOURCE_TYPE, DIRECT_SENT_FEED_SOURCE_TYPE, socialFeedDomainLabel } from '@/server/feed/visibility';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;

type ParsedPagination =
  | { limit: number; cursor: FeedCursor | null }
  | { error: string };

function encodeCursor(cursor: FeedCursor | null): string | null {
  if (!cursor) return null;

  return Buffer.from(JSON.stringify({
    source_event_at: cursor.sourceEventAt.toISOString(),
    id: cursor.id,
  })).toString('base64url');
}

function decodeCursor(value: string): FeedCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      source_event_at?: unknown;
      id?: unknown;
    };
    if (typeof parsed.source_event_at !== 'string' || typeof parsed.id !== 'string') return null;

    const sourceEventAt = new Date(parsed.source_event_at);
    if (Number.isNaN(sourceEventAt.getTime()) || parsed.id.trim().length === 0) return null;

    return { sourceEventAt, id: parsed.id };
  } catch {
    return null;
  }
}

function parsePagination(request: NextRequest): ParsedPagination {
  const limitParam = request.nextUrl.searchParams.get('limit');
  const cursorParam = request.nextUrl.searchParams.get('cursor');
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : DEFAULT_PAGE_LIMIT;

  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;
  const cursor = cursorParam ? decodeCursor(cursorParam) : null;

  if (cursorParam && !cursor) return { error: 'invalid_cursor' };

  return { limit, cursor };
}

function displayName(name: string | null, fallback = 'A friend') {
  return name?.trim() || fallback;
}

function authoredSharedAttribution(sourceName: string, domain: string | null): string {
  return domain ? `${sourceName} shared a question — ${domain}` : `${sourceName} shared a question`;
}

function directSentAttribution(sourceName: string, domain: string | null): string {
  return domain ? `${sourceName} sent you a question — ${domain}` : `${sourceName} sent you a question`;
}

function friendAnsweredAttribution(
  item: CollapsedFeedItem,
  userById: Map<string, { displayName: string | null }>,
  domain: string | null,
  authorName: string,
): string {
  const results = item.friendResults;
  if (!results || results.length === 0) {
    const name = displayName(userById.get(item.sourceUserId)?.displayName ?? null);
    return domain ? `${name} knew ${authorName}’s question — ${domain}` : `${name} knew ${authorName}’s question`;
  }

  if (results.length === 1) {
    const { displayName: answererName } = results[0];
    return domain
      ? `Common ground in ${domain}: ${answererName} knew ${authorName}’s question`
      : `${answererName} and ${authorName} share this one`;
  }

  const names = results.slice(0, 3).map(({ displayName: answererName }) => answererName).join(' · ');
  return domain ? `Common ground in ${domain}: ${names}` : `${names} share this one`;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const pagination = parsePagination(request);
  if ('error' in pagination) return NextResponse.json({ error: pagination.error }, { status: 400 });

  const { limit, cursor } = pagination;

  const [feedPage, friendCount, dismissedDomains, totalItemCount, preFilterActiveCount] = await Promise.all([
    getFeedForUser(session.userId, { limit, cursor }),
    db
      .select({ value: count() })
      .from(friendships)
      .where(and(
        eq(friendships.status, 'active'),
        or(eq(friendships.userAId, session.userId), eq(friendships.userBId, session.userId)),
      ))
      .then((rows) => rows[0]?.value ?? 0),
    getDismissedDomains(session.userId),
    db
      .select({ value: count() })
      .from(feedItems)
      .where(and(
        eq(feedItems.recipientUserId, session.userId),
        visibleFeedSourcePredicate,
      ))
      .then((rows) => rows[0]?.value ?? 0),
    db
      .select({ value: count() })
      .from(feedItems)
      .where(and(
        eq(feedItems.recipientUserId, session.userId),
        visibleFeedSourcePredicate,
        inArray(feedItems.state, ['active', 'skipped']),
      ))
      .then((rows) => rows[0]?.value ?? 0),
  ]);

  const activeItemCount = feedPage.totalCount;
  const feed = feedPage.items;
  const nextCursor = encodeCursor(feedPage.nextCursor);
  const questionIds = feed.map((item) => item.questionId).filter((id): id is string => Boolean(id));

  const [questionRows, bankedById] = await Promise.all([
    questionIds.length
      ? db.select().from(questions).where(inArray(questions.id, questionIds))
      : Promise.resolve([]),
    checkBankedQuestions(session.userId, questionIds),
  ]);

  const questionById = new Map(questionRows.map((q) => [q.id, q]));
  const userIds = [...new Set([
    ...feed.map((item) => item.sourceUserId),
    ...questionRows.map((question) => question.creatorId).filter((id): id is string => Boolean(id)),
  ])];
  const userRows = userIds.length
    ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, userIds))
    : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));

  return NextResponse.json({
    viewer_user_id: session.userId,
    meta: {
      has_friends: friendCount > 0,
      has_dismissed_domains: dismissedDomains.length > 0,
      total_item_count: totalItemCount,
      active_item_count: activeItemCount,
      pre_filter_active_count: preFilterActiveCount,
      page_item_count: feed.length,
      limit,
      cursor: cursor ? encodeCursor(cursor) : null,
      next_cursor: nextCursor,
      has_more: feedPage.hasMore,
    },
    next_cursor: nextCursor,
    has_more: feedPage.hasMore,
    items: feed.map((item) => {
      const question = item.questionId ? questionById.get(item.questionId) : undefined;
      const sourceUser = userById.get(item.sourceUserId);
      const sourceName = displayName(sourceUser?.displayName ?? null);
      const authorName = displayName(question?.creatorId ? userById.get(question.creatorId)?.displayName ?? null : null, 'the author');
      const domain = socialFeedDomainLabel(question);

      return {
        id: item.id,
        kind: 'question',
        question_id: item.questionId,
        joshing_game_id: item.joshingGameId,
        source_type: item.sourceType,
        source_user_id: item.sourceUserId,
        source_result: item.sourceResult ?? null,
        source_friend_display_name: sourceName,
        source_attribution: item.sourceType === AUTHORED_SHARED_FEED_SOURCE_TYPE
          ? authoredSharedAttribution(sourceName, domain)
          : item.sourceType === DIRECT_SENT_FEED_SOURCE_TYPE
            ? directSentAttribution(sourceName, domain)
            : friendAnsweredAttribution(item, userById, domain, authorName),
        friend_results: item.friendResults ?? null,
        source_event_at: item.sourceEventAt,
        personal_message: item.personalMessage,
        state: item.state,
        is_pinned: item.isPinned,
        question_text: question?.questionText ?? null,
        verified: question?.verified ?? true,
        is_in_bank: item.questionId ? Boolean(bankedById[item.questionId]) : false,
        explanation: question?.explainerBrief ?? question?.factualExplanation ?? null,
        domain_pill: domain,
        game_title: null,
        difficulty: question?.calibratedDifficulty ?? question?.llmDifficulty ?? question?.difficultyEstimate ?? null,
      };
    }),
  });
}
