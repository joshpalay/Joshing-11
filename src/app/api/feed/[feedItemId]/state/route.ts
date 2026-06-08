import { and, eq, inArray } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, feedItems } from '@/server/db';
import { rollOffOldItems, updateFeedItemState } from '@/server/db/queries/feed';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ feedItemId: string }>;
};

// 'active'/'restore' is the Undo path: it returns a previously dismissed (or
// skipped) card to the actionable feed so the optimistic client dismiss can be
// reversed durably, not just in session view-state.
function parseState(value: unknown): 'skipped' | 'dismissed' | 'active' | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = (value as Record<string, unknown>).state;
  if (state === 'skip' || state === 'skipped') return 'skipped';
  if (state === 'dismiss' || state === 'dismissed') return 'dismissed';
  if (state === 'active' || state === 'restore') return 'active';
  return null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { feedItemId } = await context.params;
  const state = parseState(await request.json().catch(() => null));
  if (!state) {
    return NextResponse.json(
      { error: 'validation', message: 'state must be skip, skipped, dismiss, dismissed, active, or restore' },
      { status: 400 },
    );
  }

  const [item] = await db
    .select({
      id: feedItems.id,
      recipientUserId: feedItems.recipientUserId,
      questionId: feedItems.questionId,
      sourceType: feedItems.sourceType,
    })
    .from(feedItems)
    .where(and(eq(feedItems.id, feedItemId), eq(feedItems.recipientUserId, session.userId)))
    .limit(1);

  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isCollapsedType = (item.sourceType === 'thumbs_upped' || item.sourceType === 'friend_answered') && item.questionId;
  if (isCollapsedType) {
    // Dismiss all collapsed items for this question in the recipient's feed
    const relatedItems = await db
      .select({ id: feedItems.id })
      .from(feedItems)
      .where(and(
        eq(feedItems.recipientUserId, item.recipientUserId),
        eq(feedItems.questionId, item.questionId!),
        eq(feedItems.sourceType, item.sourceType),
      ));

    await db
      .update(feedItems)
      .set({ state })
      .where(inArray(feedItems.id, relatedItems.map((r) => r.id)));
  } else {
    await updateFeedItemState(feedItemId, state);
  }

  const [updated] = await db.select().from(feedItems).where(eq(feedItems.id, feedItemId)).limit(1);
  const rolledOff = await rollOffOldItems(session.userId);

  return NextResponse.json({ item: updated ?? null, rolled_off: rolledOff });
}
