import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { QUESTION_DOMAIN_KEYS } from '@/lib/game-constants';
import { getSession } from '@/server/auth/session';
import { db, feedDismissedDomains, feedItems, questions, users } from '@/server/db';
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
import { writeActivity } from '@/server/activity/write-activity';

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
    : null;
  const creatorNote = typeof body?.creatorNote === 'string'
    ? body.creatorNote.trim() || null
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
  const verified = typeof body?.verified === 'boolean' ? body.verified : null;
  const llmSuggestedAnswer = typeof body?.llmSuggestedAnswer === 'string'
    ? body.llmSuggestedAnswer.trim() || null
    : null;
  const critiqueIterations = typeof body?.critiqueIterations === 'number' ? body.critiqueIterations : Number.NaN;

  const rawSendToFriendIds = Array.isArray(body?.sendToFriendIds)
    ? (body.sendToFriendIds as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 20)
    : [];
  const shareToFeed = body?.shareToFeed === true;

  const errors: string[] = [];
  if (!text || text.length > 300) errors.push('text');
  if (!correctAnswer || correctAnswer.length > 200) errors.push('correctAnswer');
  if (alternateAnswers.length > 5 || alternateAnswers.some((answer) => answer.length > 200)) errors.push('alternateAnswers');
  if (explanation && explanation.length > 500) errors.push('explanation');
  if (creatorNote && creatorNote.length > 200) errors.push('creatorNote');
  if (!VALID_DOMAINS.has(domain)) errors.push('domain');
  if (verified === null) errors.push('verified');
  if (!Number.isInteger(critiqueIterations) || critiqueIterations < 0) errors.push('critiqueIterations');
  if (!Number.isInteger(difficultyValue) || difficultyValue < 1 || difficultyValue > 5) errors.push('difficulty');
  if (shareToFeed && rawSendToFriendIds.length > 0) errors.push('shareToFeed');

  return {
    value: { text, correctAnswer, alternateAnswers, explanation, creatorNote, domain, difficulty: difficultyValue, verified: verified ?? true, llmSuggestedAnswer, critiqueIterations: Number.isInteger(critiqueIterations) ? critiqueIterations : 0, sendToFriendIds: rawSendToFriendIds, shareToFeed },
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

  const { sendToFriendIds, shareToFeed, ...questionFields } = value;

  if (sendToFriendIds.length > 0) {
    const friends = await getFriends(session.userId);
    const friendIdSet = new Set(friends.map((friend) => friend.id));
    const hasInvalidRecipient = sendToFriendIds.some((id) => !friendIdSet.has(id));

    if (hasInvalidRecipient) {
      return NextResponse.json(
        { error: 'One or more recipients are not friends.' },
        { status: 403 },
      );
    }
  }

  const created = await createQuestion({ authorId: session.userId, ...questionFields });
  console.info('[questions/create]', { questionId: created.id, userId: session.userId, verified: questionFields.verified });
  const kbResult = await openKBDomain({
    userId: session.userId,
    domain: questionFields.domain,
    via: 'authorship',
    questionId: created.id,
  });
  const question = await getQuestion(created.id, session.userId);

  if (shareToFeed) {
    try {
      const friends = await getFriends(session.userId);
      const concurrency = 5;
      let sharedCount = 0;

      for (let index = 0; index < friends.length; index += concurrency) {
        const batch = friends.slice(index, index + concurrency);
        const results = await Promise.all(batch.map(async (friend) => {
          const [dismissed] = await db
            .select({ id: feedDismissedDomains.id })
            .from(feedDismissedDomains)
            .where(and(
              eq(feedDismissedDomains.userId, friend.id),
              eq(feedDismissedDomains.canonicalSubcategory, questionFields.domain),
              isNull(feedDismissedDomains.reinstatedAt),
            ))
            .limit(1);

          if (dismissed) return false;

          const [existing] = await db
            .select({ id: feedItems.id })
            .from(feedItems)
            .where(and(
              eq(feedItems.recipientUserId, friend.id),
              eq(feedItems.questionId, created.id),
            ))
            .limit(1);

          if (existing) return false;

          await db.insert(feedItems).values({
            recipientUserId: friend.id,
            sourceUserId: session.userId,
            questionId: created.id,
            sourceType: 'authored_shared',
            sourceResult: null,
            state: 'active',
            isPinned: false,
            sourceEventAt: new Date(),
          });
          await rollOffOldItems(friend.id);
          return true;
        }));
        sharedCount += results.filter(Boolean).length;
      }

      await db.update(questions).set({ sharedToFriendsFeed: true }).where(eq(questions.id, created.id));
      await writeActivity({
        userId: session.userId,
        type: 'authored_question_shared',
        referenceId: created.id,
        referenceType: 'question',
      });
      console.info('[questions/shareToFeed]', { questionId: created.id, userId: session.userId, recipientCount: sharedCount });
    } catch (error) {
      console.error('[questions/shareToFeed] broadcast share failed (suppressed):', {
        questionId: created.id,
        userId: session.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (sendToFriendIds.length > 0) {
    const [senderRow] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    const senderName = senderRow?.displayName?.trim() || 'A friend';

    for (const recipientId of sendToFriendIds) {
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
