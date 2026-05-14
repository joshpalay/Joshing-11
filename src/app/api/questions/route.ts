import { and, eq, inArray, isNull } from 'drizzle-orm';
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
import { DIRECT_SENT_FEED_SOURCE_TYPE } from '@/server/feed/visibility';
import { readCreateQuestionPayload } from '@/server/questions/create-payload';
import { assessQuestionDifficulty } from '@/server/questions/llm-difficulty';

export const dynamic = 'force-dynamic';

function shouldIncludeShareRecipientDiagnostics() {
  return process.env.NODE_ENV !== 'production' || process.env.SHARE_TO_FEED_DEBUG_RECIPIENT_IDS === 'true';
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
  const feedShare = { requested: shareToFeed, createdCount: 0 };

  if (shareToFeed) {
    const friends = await getFriends(session.userId);
    const friendIds = friends.map((friend) => friend.id);
    const dismissedRecipientIds = new Set<string>();

    if (friendIds.length > 0 && categorizedQuestionFields.canonicalSubcategory) {
      const dismissedRows = await db
        .select({ userId: feedDismissedDomains.userId })
        .from(feedDismissedDomains)
        .where(and(
          inArray(feedDismissedDomains.userId, friendIds),
          eq(feedDismissedDomains.canonicalSubcategory, categorizedQuestionFields.canonicalSubcategory),
          isNull(feedDismissedDomains.reinstatedAt),
        ));

      for (const row of dismissedRows) {
        dismissedRecipientIds.add(row.userId);
      }
    }

    let sharedCount = 0;
    const sharedRecipientIds: string[] = [];
    const skippedDismissedDomainRecipientIds: string[] = [];
    const skippedExistingFeedRecipientIds: string[] = [];

    for (const friend of friends) {
      if (dismissedRecipientIds.has(friend.id)) {
        skippedDismissedDomainRecipientIds.push(friend.id);
        continue;
      }

      const alreadyInFeed = await userHasQuestionInBlockingFeed(friend.id, created.id);
      if (alreadyInFeed) {
        skippedExistingFeedRecipientIds.push(friend.id);
        continue;
      }

      await db.insert(feedItems).values({
        recipientUserId: friend.id,
        questionId: created.id,
        sourceType: 'authored_shared',
        sourceUserId: session.userId,
        sourceEventAt: new Date(),
        state: 'active',
      });
      await rollOffOldItems(friend.id);
      sharedRecipientIds.push(friend.id);
      sharedCount += 1;
    }

    feedShare.createdCount = sharedCount;

    if (sharedCount > 0) {
      await db.update(questions).set({ sharedToFriendsFeed: true }).where(eq(questions.id, created.id));
    }

    const includeRecipientDiagnostics = shouldIncludeShareRecipientDiagnostics();
    console.info('[questions/shareToFeed]', {
      questionId: created.id,
      userId: session.userId,
      requested: true,
      friendCount: friends.length,
      sharedCount,
      ...(includeRecipientDiagnostics ? { sharedRecipientIds } : {}),
      skippedDismissedDomainCount: skippedDismissedDomainRecipientIds.length,
      ...(includeRecipientDiagnostics ? { skippedDismissedDomainRecipientIds } : {}),
      skippedExistingFeedCount: skippedExistingFeedRecipientIds.length,
      ...(includeRecipientDiagnostics ? { skippedExistingFeedRecipientIds } : {}),
    });
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
        sourceType: DIRECT_SENT_FEED_SOURCE_TYPE,
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
      feedShare,
    },
    { status: 201 },
  );
}
