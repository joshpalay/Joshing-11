import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, feedItems } from '@/server/db';
import { rollOffOldItems, updateFeedItemState } from '@/server/db/queries/feed';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ feedItemId: string }>;
};

function parseState(value: unknown): 'skipped' | 'dismissed' | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = (value as Record<string, unknown>).state;
  return state === 'skip' || state === 'skipped'
    ? 'skipped'
    : state === 'dismiss' || state === 'dismissed'
      ? 'dismissed'
      : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { feedItemId } = await context.params;
  const state = parseState(await request.json().catch(() => null));
  if (!state) {
    return NextResponse.json(
      { error: 'validation', message: 'state must be skip, skipped, dismiss, or dismissed' },
      { status: 400 },
    );
  }

  const [item] = await db
    .select({ id: feedItems.id })
    .from(feedItems)
    .where(and(eq(feedItems.id, feedItemId), eq(feedItems.recipientUserId, session.userId)))
    .limit(1);

  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const updated = await updateFeedItemState(feedItemId, state);
  const rolledOff = await rollOffOldItems(session.userId);

  return NextResponse.json({ item: updated, rolled_off: rolledOff });
}
