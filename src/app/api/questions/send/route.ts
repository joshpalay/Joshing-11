import { and, eq, gte, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, feedItems, questions, users } from '@/server/db';
import { areFriends } from '@/server/db/queries/friends';
import {
  createFeedItem,
  rollOffOldItems,
  userAnsweredQuestionCorrectly,
  userHasQuestionInBlockingFeed,
} from '@/server/db/queries/feed';
import { sendSms } from '@/server/sms';

export const dynamic = 'force-dynamic';

function parseBody(value: unknown): { questionId: string; recipientUserId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const questionId = typeof record.question_id === 'string'
    ? record.question_id
    : typeof record.questionId === 'string'
      ? record.questionId
      : null;
  const recipientUserId = typeof record.recipient_user_id === 'string'
    ? record.recipient_user_id
    : typeof record.friend_id === 'string'
      ? record.friend_id
      : typeof record.recipientUserId === 'string'
        ? record.recipientUserId
        : null;

  return questionId && recipientUserId ? { questionId, recipientUserId } : null;
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json(
      { error: 'validation', message: 'question_id and recipient_user_id are required' },
      { status: 400 },
    );
  }
  if (parsed.recipientUserId === session.userId) {
    return NextResponse.json({ error: 'validation', message: 'Choose a friend to send this to.' }, { status: 400 });
  }

  const [question, recipient, senderNameRow, friendship] = await Promise.all([
    db.select().from(questions).where(eq(questions.id, parsed.questionId)).limit(1),
    db.select().from(users).where(eq(users.id, parsed.recipientUserId)).limit(1),
    db.select({ displayName: users.displayName }).from(users).where(eq(users.id, session.userId)).limit(1),
    areFriends(session.userId, parsed.recipientUserId),
  ]);

  if (!question[0] || !recipient[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!friendship) return NextResponse.json({ error: 'not_friends', message: 'You can only send to friends.' }, { status: 403 });

  const [alreadyCorrect, alreadyInFeed] = await Promise.all([
    userAnsweredQuestionCorrectly(parsed.recipientUserId, parsed.questionId),
    userHasQuestionInBlockingFeed(parsed.recipientUserId, parsed.questionId),
  ]);
  if (alreadyCorrect) {
    return NextResponse.json(
      { error: 'already_answered', message: 'That friend has already answered this one correctly.' },
      { status: 409 },
    );
  }
  if (alreadyInFeed) {
    return NextResponse.json(
      { error: 'already_in_feed', message: 'That question is already waiting in their Feed.' },
      { status: 409 },
    );
  }

  const [sentToday] = await db
    .select({ count: sql<number>`count(*)` })
    .from(feedItems)
    .where(and(
      eq(feedItems.recipientUserId, parsed.recipientUserId),
      eq(feedItems.sourceUserId, session.userId),
      eq(feedItems.sourceType, 'direct_sent'),
      gte(feedItems.sourceEventAt, startOfUtcDay()),
    ));

  if (Number(sentToday?.count ?? 0) >= 5) {
    return NextResponse.json(
      { error: 'daily_limit', message: 'You have sent this friend five questions today.' },
      { status: 429 },
    );
  }

  const created = await createFeedItem({
    recipientUserId: parsed.recipientUserId,
    questionId: parsed.questionId,
    sourceType: 'direct_sent',
    sourceUserId: session.userId,
    sourceEventAt: new Date(),
    state: 'active',
    isPinned: true,
  });

  await rollOffOldItems(parsed.recipientUserId);

  const recipientUser = recipient[0];
  if (recipientUser.phoneNumber && recipientUser.smsOptIn !== 'opted_out') {
    const senderName = senderNameRow[0]?.displayName?.trim() || 'A friend';
    const feedUrl = `${request.nextUrl.origin}/feed`;
    await sendSms(
      recipientUser.phoneNumber,
      `${senderName} sent you a question. ${feedUrl}`,
      'question_reaction' as never,
      recipientUser.id,
    );
  }

  return NextResponse.json({ item: created }, { status: 201 });
}
