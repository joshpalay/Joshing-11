import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { QUESTION_DOMAIN_KEYS } from '@/lib/game-constants';
import { getSession } from '@/server/auth/session';
import { db, feedItems, questions, users } from '@/server/db';
import {
  createQuestion,
  getQuestion,
  getQuestionsForUser,
} from '@/server/db/queries/questions';
import { getFriends } from '@/server/db/queries/friends';
import {
  rollOffOldItems,
  userHasQuestionInBlockingFeed,
  userAnsweredQuestionCorrectly,
} from '@/server/db/queries/feed';
import { openKBDomain } from '@/server/knowledge/open-domain';
import { sendSms } from '@/server/sms';

export const dynamic = 'force-dynamic';

const VALID_DOMAINS = new Set<string>(QUESTION_DOMAIN_KEYS);

function splitAlternates(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function difficultyFromLegacy(value: unknown): number | null {
  if (value === 'accessible') return 1;
  if (value === 'moderate') return 3;
  if (value === 'specialist') return 5;
  return null;
}

function readCreatePayload(body: Record<string, unknown> | null) {
  const text = typeof body?.text === 'string'
    ? body.text.trim()
    : typeof body?.question_text === 'string'
      ? body.question_text.trim()
      : '';
  const correctAnswer = typeof body?.correctAnswer === 'string'
    ? body.correctAnswer.trim()
    : typeof body?.answer_text === 'string'
      ? body.answer_text.trim()
      : '';
  const alternateAnswers = splitAlternates(body?.alternateAnswers ?? body?.accepted_alternatives).slice(0, 5);
  const explanation = typeof body?.explanation === 'string'
    ? body.explanation.trim() || null
    : typeof body?.creator_note === 'string'
      ? body.creator_note.trim() || null
      : null;
  const isLegacyPayload = typeof body?.question_text === 'string' || typeof body?.answer_text === 'string';
  const domain = typeof body?.domain === 'string'
    ? body.domain
    : typeof body?.category === 'string'
      ? body.category
      : isLegacyPayload
        ? 'other'
        : '';
  const difficulty = typeof body?.difficulty === 'number'
    ? body.difficulty
    : difficultyFromLegacy(body?.difficulty_estimate) ?? (isLegacyPayload ? 3 : null);
  const difficultyValue = difficulty ?? Number.NaN;

  const rawSendToFriendIds = Array.isArray(body?.sendToFriendIds)
    ? (body.sendToFriendIds as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 20)
    : [];

  const errors: string[] = [];
  if (!text || text.length > 300) errors.push('text');
  if (!correctAnswer || correctAnswer.length > 200) errors.push('correctAnswer');
  if (alternateAnswers.length > 5 || alternateAnswers.some((answer) => answer.length > 200)) errors.push('alternateAnswers');
  if (explanation && explanation.length > 500) errors.push('explanation');
  if (!VALID_DOMAINS.has(domain)) errors.push('domain');
  if (!Number.isInteger(difficultyValue) || difficultyValue < 1 || difficultyValue > 5) errors.push('difficulty');

  return {
    value: { text, correctAnswer, alternateAnswers, explanation, domain, difficulty: difficultyValue, sendToFriendIds: rawSendToFriendIds },
    errors,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  return NextResponse.json({ questions: await getQuestionsForUser(session.userId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { value, errors } = readCreatePayload(body);
  if (errors.length > 0) {
    return NextResponse.json({ error: 'validation', fields: errors }, { status: 400 });
  }

  const { sendToFriendIds, ...questionFields } = value;

  const created = await createQuestion({ authorId: session.userId, ...questionFields });
  const kbResult = await openKBDomain({
    userId: session.userId,
    domain: questionFields.domain,
    via: 'authorship',
    questionId: created.id,
  });
  const question = await getQuestion(created.id, session.userId);

  if (sendToFriendIds.length > 0) {
    // Validate that all recipients are actual friends
    const friends = await getFriends(session.userId);
    const friendIdSet = new Set(friends.map((f) => f.id));
    const validRecipients = sendToFriendIds.filter((id) => friendIdSet.has(id));

    const [senderRow] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    const senderName = senderRow?.displayName?.trim() || 'A friend';

    for (const recipientId of validRecipients) {
      const alreadyCorrect = await userAnsweredQuestionCorrectly(recipientId, created.id);
      if (alreadyCorrect) continue;
      const alreadyInFeed = await userHasQuestionInBlockingFeed(recipientId, created.id);
      if (alreadyInFeed) continue;

      const [recipientRow] = await db
        .select({ phoneNumber: users.phoneNumber, smsOptIn: users.smsOptIn })
        .from(users)
        .where(eq(users.id, recipientId))
        .limit(1);

      await db.insert(feedItems).values({
        recipientUserId: recipientId,
        questionId: created.id,
        sourceType: 'direct_sent',
        sourceUserId: session.userId,
        sourceEventAt: new Date(),
        state: 'active',
        isPinned: true,
      });
      await rollOffOldItems(recipientId);

      if (recipientRow?.phoneNumber && recipientRow.smsOptIn !== 'opted_out') {
        const feedUrl = `${request.nextUrl.origin}/feed`;
        await sendSms(
          recipientRow.phoneNumber,
          `${senderName} sent you a question. ${feedUrl}`,
          'question_reaction' as never,
          recipientId,
        );
      }
    }

    await db.update(questions).set({ sharedToFriendsFeed: true }).where(eq(questions.id, created.id));
  }

  return NextResponse.json(
    {
      ...created,
      question,
      ...(question ?? {}),
      openedDomain: kbResult.opened ? questionFields.domain : null,
    },
    { status: 201 },
  );
}
