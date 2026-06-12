import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, feedItems } from '@/server/db';
import { recordFeedThumbsUp } from '@/server/db/queries/ratings';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ feedItemId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { feedItemId } = await context.params;
  const [item] = await db
    .select()
    .from(feedItems)
    .where(and(eq(feedItems.id, feedItemId), eq(feedItems.recipientUserId, session.userId)))
    .limit(1);

  if (!item?.questionId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Quality signal + surface-priority bump live in the query layer next to the
  // bank-rating writes, so the two surfacePriorityScore paths can't drift.
  // Thumbs-up affects ordering (eventually), not propagation.
  await recordFeedThumbsUp(session.userId, item.questionId);

  return NextResponse.json({ ok: true });
}
