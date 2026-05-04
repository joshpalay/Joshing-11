import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, feedItems, questionFeedback } from '@/server/db';

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

  // Record quality signal (thumbs-down = unfair/poorly formed question)
  await db
    .insert(questionFeedback)
    .values({
      userId: session.userId,
      questionId: item.questionId,
      signal: 'thumbs_down',
    })
    .onConflictDoUpdate({
      target: [questionFeedback.userId, questionFeedback.questionId],
      set: { signal: 'thumbs_down' },
    });

  // Remove from this user's Feed
  await db
    .update(feedItems)
    .set({ state: 'dismissed' })
    .where(and(eq(feedItems.id, feedItemId), eq(feedItems.recipientUserId, session.userId)));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { feedItemId } = await context.params;
  const [item] = await db
    .select()
    .from(feedItems)
    .where(and(eq(feedItems.id, feedItemId), eq(feedItems.recipientUserId, session.userId)))
    .limit(1);

  if (!item?.questionId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Remove thumbs_down signal
  await db
    .delete(questionFeedback)
    .where(and(
      eq(questionFeedback.userId, session.userId),
      eq(questionFeedback.questionId, item.questionId),
      eq(questionFeedback.signal, 'thumbs_down'),
    ));

  // Restore feed item to active
  await db
    .update(feedItems)
    .set({ state: 'active' })
    .where(and(eq(feedItems.id, feedItemId), eq(feedItems.recipientUserId, session.userId)));

  return NextResponse.json({ ok: true });
}
