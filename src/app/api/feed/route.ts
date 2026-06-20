import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { type FeedCursor, type FeedFilter } from '@/server/db/queries/feed';
import { decodeFeedCursor, getFeedPagePayload } from '@/server/feed/get-feed-page';
import { createServerTiming, logServerTiming } from '@/server/lib/server-timing';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;

type ParsedPagination =
  | { limit: number; cursor: FeedCursor | null; filter: FeedFilter }
  | { error: string };

function parsePagination(request: NextRequest): ParsedPagination {
  const limitParam = request.nextUrl.searchParams.get('limit');
  const cursorParam = request.nextUrl.searchParams.get('cursor');
  const filterParam = request.nextUrl.searchParams.get('filter') ?? request.nextUrl.searchParams.get('feed_filter') ?? 'all';
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : DEFAULT_PAGE_LIMIT;

  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;
  const cursor = cursorParam ? decodeFeedCursor(cursorParam) : null;

  if (cursorParam && !cursor) return { error: 'invalid_cursor' };
  if (filterParam !== 'all' && filterParam !== 'sent-to-me' && filterParam !== 'from-friends') {
    return { error: 'invalid_filter' };
  }

  return { limit, cursor, filter: filterParam };
}

export async function GET(request: NextRequest) {
  const timing = createServerTiming();
  const startedAt = Date.now();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const pagination = parsePagination(request);
  if ('error' in pagination) return NextResponse.json({ error: pagination.error }, { status: 400 });

  const payload = await getFeedPagePayload(session.userId, pagination);
  timing.measure('feed', startedAt);

  const verboseFeedDebug = process.env.FEED_DEBUG_VERBOSE === 'true';
  console.info('[feed/get]', {
    userId: session.userId,
    limit: pagination.limit,
    filter: pagination.filter,
    cursorPresent: Boolean(pagination.cursor),
    friendCount: payload.meta.has_friends ? 'positive' : 0,
    dismissedDomainCount: payload.meta.has_dismissed_domains ? 'positive' : 0,
    totalItemCount: payload.meta.total_item_count,
    preFilterActiveCount: payload.meta.pre_filter_active_count,
    activeItemCount: payload.meta.active_item_count,
    pageItemCount: payload.meta.page_item_count,
    hasMore: payload.meta.has_more,
    ...(verboseFeedDebug
      ? {
          feedItemPreview: payload.items.map((item) => ({
            id: item.id,
            sourceType: item.source_type,
          })),
        }
      : {}),
  });

  logServerTiming('feed', timing, { filter: pagination.filter, items: payload.meta.page_item_count });

  const response = NextResponse.json(payload);
  response.headers.set('Server-Timing', timing.toHeader());
  return response;
}
