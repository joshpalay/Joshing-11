import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { broadCategoryDisplayName, normalizeBroadQuestionCategoryOrDefault, normalizeCanonicalSubcategory } from '@/lib/question-categorization';
import { categorizeQuestion } from '@/lib/llm';
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
import { readCreateQuestionPayload } from '@/server/questions/create-payload';
import { assessQuestionDifficulty } from '@/server/questions/llm-difficulty';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  return NextResponse.json({ questions: await getQuestionsForUser(session.userId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { value, errors } = readCreateQuestionPayload(body);
  if (errors.length > 0) {
    return NextResponse.json({ error: 'validation', fields: errors }, { status: 400 });
  }

  const { sendToFriendIds, shareToFeed, ...rawQuestionFields } = value;
  const categorization = await categorizeQuestion(rawQuestionFields.text, rawQuestionFields.correctAnswer);
  const category = normalizeBroadQuestionCategoryOrDefault(categorization.broad_category);
  const canonicalSubcategory = normalizeCanonicalSubcategory(categorization.subcategory) || 'General Knowledge';
  const questionFields = {
    ...rawQuestionFields,
    category,
    broadCategory: broadCategoryDisplayName(category),
    canonicalSubcategory,
    subcategory: canonicalSubcategory,
    domain: canonicalSubcategory,
  };
  const difficultyAssessment = await assessQuestionDifficulty({
    questionText: questionFields.text,
    correctAnswer: questionFields.correctAnswer,
    broadCategory: questionFields.broadCategory,
    canonicalSubcategory: questionFields.canonicalSubcategory,
    explanation: questionFields.explanation,
  });
  const categorizedQuestionFields = { ...questionFields, difficulty: difficultyAssessment.difficulty };

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

  const created = await createQuestion({ authorId: session.userId, ...categorizedQuestionFields });
  console.info('[questions/create]', { questionId: created.id, userId: session.userId, verified: categorizedQuestionFields.verified, category: categorizedQuestionFields.category, canonicalSubcategory: categorizedQuestionFields.canonicalSubcategory, difficultyTier: difficultyAssessment.tier });
  const kbResult = await openKBDomain({
    userId: session.userId,
    domain: categorizedQuestionFields.canonicalSubcategory,
    via: 'authorship',
    broadCategory: categorizedQuestionFields.broadCategory,
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
              eq(feedDismissedDomains.canonicalSubcategory, categorizedQuestionFields.canonicalSubcategory),
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
      openedDomain: kbResult.opened ? categorizedQuestionFields.canonicalSubcategory : null,
    },
    { status: 201 },
  );
}
