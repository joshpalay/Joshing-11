import { and, eq, gt, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { writeActivity } from '@/server/activity/write-activity';
import { getSession } from '@/server/auth/session';
import { db, feedItems, generatedQuestions, questions, users } from '@/server/db';
import {
  createFeedItem,
  rollOffOldItems,
  userAnsweredQuestionCorrectly,
  userHasQuestionInBlockingFeed,
} from '@/server/db/queries/feed';
import { getFriends } from '@/server/db/queries/friends';
import { sendSms } from '@/server/sms';
import { DIRECT_SENT_FEED_SOURCE_TYPE } from '@/server/feed/visibility';

export const dynamic = 'force-dynamic';

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
    return NextResponse.json(
      { error: 'validation', message: 'Choose a friend to send this to.' },
      { status: 400 },
    );
  }

  const friends = await getFriends(session.userId);
  if (!friends.some((friend) => friend.id === parsed.recipientUserId)) {
    return NextResponse.json({ error: 'Recipient is not a friend.' }, { status: 403 });
  }

  const sendableQuestionId = await resolveQuestionIdForSend(parsed.questionId);

  const [question, recipient, senderNameRow] = await Promise.all([
    sendableQuestionId
      ? db.select().from(questions).where(eq(questions.id, sendableQuestionId)).limit(1)
      : Promise.resolve([]),
    db.select().from(users).where(eq(users.id, parsed.recipientUserId)).limit(1),
    db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1),
  ]);

  if (!question[0] || !recipient[0])
    return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [alreadyCorrect, alreadyInFeed] = await Promise.all([
    userAnsweredQuestionCorrectly(parsed.recipientUserId, sendableQuestionId!),
    userHasQuestionInBlockingFeed(parsed.recipientUserId, sendableQuestionId!),
  ]);
  if (alreadyCorrect) {
    return NextResponse.json(
      {
        error: 'already_answered',
        message: 'That friend has already answered this one correctly.',
      },
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
    .where(
      and(
        eq(feedItems.recipientUserId, parsed.recipientUserId),
        eq(feedItems.sourceUserId, session.userId),
        eq(feedItems.sourceType, DIRECT_SENT_FEED_SOURCE_TYPE),
        gt(feedItems.createdAt, lastTwentyFourHours()),
      ),
    );

  if (Number(sentToday?.count ?? 0) >= 5) {
    return NextResponse.json(
      { error: "You've sent this person 5 questions today. Try again tomorrow." },
      { status: 429 },
    );
  }

  const created = await createFeedItem({
    recipientUserId: parsed.recipientUserId,
    questionId: sendableQuestionId!,
    sourceType: DIRECT_SENT_FEED_SOURCE_TYPE,
    sourceUserId: session.userId,
    sourceEventAt: new Date(),
    personalMessage: parsed.personalMessage,
    state: 'active',
    isPinned: true,
  });

  await writeActivity({
    userId: parsed.recipientUserId,
    type: 'received_direct_question',
    actorUserId: session.userId,
    referenceId: created.id,
    referenceType: 'feed_item',
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

function parseBody(
  value: unknown,
): { questionId: string; recipientUserId: string; personalMessage: string | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const questionId =
    typeof record.question_id === 'string'
      ? record.question_id
      : typeof record.questionId === 'string'
        ? record.questionId
        : null;
  const recipientUserId =
    typeof record.recipient_user_id === 'string'
      ? record.recipient_user_id
      : typeof record.friend_id === 'string'
        ? record.friend_id
        : typeof record.recipientUserId === 'string'
          ? record.recipientUserId
          : null;
  const rawMessage =
    typeof record.personalMessage === 'string'
      ? record.personalMessage
      : typeof record.personal_message === 'string'
        ? record.personal_message
        : '';
  const personalMessage = rawMessage.trim().slice(0, 200) || null;

  return questionId && recipientUserId ? { questionId, recipientUserId, personalMessage } : null;
}

function lastTwentyFourHours(date = new Date()) {
  return new Date(date.getTime() - 24 * 60 * 60 * 1000);
}

export async function resolveQuestionIdForSend(questionId: string): Promise<string | null> {
  const [question] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);
  if (question) return question.id;

  const [generated] = await db
    .select()
    .from(generatedQuestions)
    .where(eq(generatedQuestions.id, questionId))
    .limit(1);

  if (!generated) return null;

  // A sent LLM question keeps its LLM/curated provenance: no author is recorded
  // (creatorId stays null so author/curator credit never accrues to the
  // forwarder), and source is 'curated_sent' so it is queryably distinct from
  // both authored questions and daily-generated ones. Who sent it is preserved
  // separately on the FeedItem (sourceUserId) written by the caller.
  const [created] = await db
    .insert(questions)
    .values({
      creatorId: null,
      sourceQuestionId: generated.id,
      source: 'curated_sent',
      questionText: generated.questionText,
      answerText: generated.answer,
      factualExplanation: generated.explainer,
      category: 'general_knowledge',
      broadCategory: generated.broadCategory,
      canonicalSubcategory: generated.canonicalSubcategory,
      difficultyEstimate:
        generated.difficultyEstimate === 'accessible' ||
        generated.difficultyEstimate === 'moderate' ||
        generated.difficultyEstimate === 'specialist'
          ? generated.difficultyEstimate
          : null,
    })
    .returning({ id: questions.id });

  return created?.id ?? null;
}
