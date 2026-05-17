import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { backfillMissingFeedItemsForAnswerer } from '@/server/feed/backfill-missing-feed-items';

export const dynamic = 'force-dynamic';

function isFeedDebugEnabled() {
  if (process.env.FEED_DEBUG_ENABLED === 'true') return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.VERCEL_ENV !== undefined && process.env.VERCEL_ENV !== 'production';
}

async function handle(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isFeedDebugEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const params = request.nextUrl.searchParams;
  const answerer = params.get('answerer')?.trim() || undefined;
  const dryRun = params.get('dryRun') === 'true';
  const rawLimit = Number(params.get('limit') ?? '200');
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 200, 1), 1000);

  const result = await backfillMissingFeedItemsForAnswerer({
    answererUserId: answerer,
    dryRun,
    limit,
  });

  return NextResponse.json({
    answerer: answerer ?? null,
    dryRun,
    limit,
    ...result,
  });
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
