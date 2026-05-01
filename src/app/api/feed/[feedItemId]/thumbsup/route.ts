import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, feedItems, questionFeedback } from '@/server/db';
import { getFriends } from '@/server/db/queries/friends';
import { rollOffOldItems, userAnsweredQuestionCorrectly } from '@/server/db/queries/feed';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ feedItemId: string }>;
};

async function hasBlockingFeedItem(userId: string, questionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: feedItems.id })
    .from(feedItems)
    .where(and(
      eq(feedItems.recipientUserId, userId),
      eq(feedItems.questionId, questionId),
      inArray(feedItems.state, ['active', 'skipped', 'dismissed']),
    ))
    .limit(1);

  return Boolean(row);
}

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

  await db
    .insert(questionFeedback)
    .values({
      userId: session.userId,
      questionId: item.questionId,
      signal: 'thumbs_up',
    })
    .onConflictDoNothing();

  const friends = await getFriends(session.userId);
  const createdFor: string[] = [];

  for (const friend of friends) {
    const [alreadyInFeed, alreadyCorrect] = await Promise.all([
      hasBlockingFeedItem(friend.id, item.questionId),
      userAnsweredQuestionCorrectly(friend.id, item.questionId),
    ]);
    if (alreadyInFeed || alreadyCorrect) continue;

    await db.insert(feedItems).values({
      recipientUserId: friend.id,
      questionId: item.questionId,
      sourceType: 'thumbs_upped',
      sourceUserId: session.userId,
      sourceEventAt: new Date(),
      state: 'active',
      isPinned: false,
    });
    await rollOffOldItems(friend.id);
    createdFor.push(friend.id);
  }

  return NextResponse.json({ ok: true, created_count: createdFor.length, created_for_user_ids: createdFor });
}
