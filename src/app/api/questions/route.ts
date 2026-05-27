import { and, eq, inArray, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { broadCategoryDisplayName, normalizeBroadQuestionCategoryOrDefault, normalizeCanonicalSubcategory } from '@/lib/question-categorization';
import { categorizeQuestion, generateInsideJoke } from '@/lib/llm';
import { verdictToPublicStatus, vetQuestion } from '@/server/llm/vet-question';
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
import { textContainsAnswer } from '@/server/questions/self-answering';
import { assessQuestionDifficulty } from '@/server/questions/llm-difficulty';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';

export const dynamic = 'force-dynamic';

function shouldIncludeShareRecipientDiagnostics() {
  return process.env.NODE_ENV !== 'production' || process.env.SHARE_TO_FEED_DEBUG_RECIPIENT_IDS === 'true';
}

function hasPayloadKey(body: Record<string, unknown> | null, key: string) {
  return Object.prototype.hasOwnProperty.call(body ?? {}, key);
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
  console.info('[questions/createPayload]', {
    userId: session.userId,
    hasErrors: errors.length > 0,
    shareToFeed: value.shareToFeed,
    sendToFriendCount: value.sendToFriendIds.length,
    payloadShareKeysPresent: {
      shareToFeed: hasPayloadKey(body, 'shareToFeed'),
      shareWithFriends: hasPayloadKey(body, 'shareWithFriends'),
      share_with_friends: hasPayloadKey(body, 'share_with_friends'),
      share_to_feed: hasPayloadKey(body, 'share_to_feed'),
      sharedToFriendsFeed: hasPayloadKey(body, 'sharedToFriendsFeed'),
    },
  });
  if (errors.length > 0) {
    if (errors.includes('answerInQuestion')) {
      return NextResponse.json(
        {
          error: 'answer_in_question',
          fields: errors,
          message: 'Your question appears to contain its own answer. Rephrase the question so it does not reveal the answer.',
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'validation', fields: errors }, { status: 400 });
  }

  const { sendToFriendIds, shareToFeed, ...rawQuestionFields } = value;

  let categorization;
  let difficultyAssessment;
  let insideJoke;
  let verdict;
  try {
    categorization = await categorizeQuestion(
      rawQuestionFields.text,
      rawQuestionFields.correctAnswer,
      rawQuestionFields.alternateAnswers,
    );
  } catch (error) {
    console.error('[questions/create] unexpected_failure', {
      stage: 'categorize',
      userId: session.userId,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'server_error', message: 'Something went wrong saving that question. Try again.' },
      { status: 500 },
    );
  }
  const category = normalizeBroadQuestionCategoryOrDefault(categorization.broad_category);
  const normalizedSubcategory = normalizeCanonicalSubcategory(categorization.subcategory);

  // F4.5: reject creation if categorization produced a generic bucket label.
  // The LLM helper already re-prompts (see GENERIC_SUBCATEGORY_NORMALIZED in
  // src/lib/llm.ts) so reaching here means the LLM couldn't find a
  // hyper-specific label — better to fail fast than silently file under
  // 'General Knowledge'.
  if (isGenericSubcategory(normalizedSubcategory)) {
    console.warn('[questions/create] rejected generic canonical_subcategory', {
      attempted: normalizedSubcategory,
      llmSubcategory: categorization.subcategory,
    });
    return NextResponse.json(
      {
        error: 'category_too_generic',
        message:
          "We couldn't pin a specific category for this question. Try rephrasing with a more specific topic.",
      },
      { status: 422 },
    );
  }
  // The categorizer has its own de-leak retry (see categorizeQuestion in
  // src/lib/llm.ts). If a leaky label still slipped through, save anyway and
  // mark the question ineligible for the shared pool — the user wrote a
  // legitimate question and we shouldn't block them on the categorizer.
  const categoryLeaksAnswer = textContainsAnswer(
    normalizedSubcategory,
    value.correctAnswer,
    value.alternateAnswers,
  );
  if (categoryLeaksAnswer) {
    console.warn('[questions/create] category leaks answer (saving anyway)', {
      subcategory: normalizedSubcategory,
      answer: value.correctAnswer,
    });
  }
  const canonicalSubcategory = normalizedSubcategory;
  const questionFields = {
    ...rawQuestionFields,
    category,
    broadCategory: broadCategoryDisplayName(category),
    canonicalSubcategory,
    subcategory: canonicalSubcategory,
    domain: canonicalSubcategory,
  };
  // Difficulty assessment, inside joke, and Haiku-vet all consume the same
  // inputs (question + answer + category) and don't depend on each other's
  // output — run them in parallel so the route's wall-clock is ~1× a single
  // LLM call instead of 3×. Categorization upstream is the only true
  // sequencing dependency in this handler. Haiku-vet failure is meant to be
  // non-fatal (the /api/cron/vet-questions sweep retries), but bundling it
  // here is fine because Promise.all rejects fast and we treat the trio as
  // a single enrichment stage.
  try {
    [difficultyAssessment, insideJoke, verdict] = await Promise.all([
      assessQuestionDifficulty({
        questionText: questionFields.text,
        correctAnswer: questionFields.correctAnswer,
        broadCategory: questionFields.broadCategory,
        canonicalSubcategory: questionFields.canonicalSubcategory,
        explanation: questionFields.explanation,
      }),
      generateInsideJoke({
        questionText: questionFields.text,
        correctAnswer: questionFields.correctAnswer,
        broadCategory: questionFields.broadCategory,
        canonicalSubcategory: questionFields.canonicalSubcategory,
      }),
      vetQuestion({
        questionText: questionFields.text,
        answer: questionFields.correctAnswer,
        alternateAnswers: questionFields.alternateAnswers,
        explanation: questionFields.explanation ?? null,
        broadCategory: questionFields.broadCategory,
        canonicalSubcategory: questionFields.canonicalSubcategory,
      }),
    ]);
  } catch (error) {
    console.error('[questions/create] unexpected_failure', {
      stage: 'enrichment',
      userId: session.userId,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'server_error', message: 'Something went wrong saving that question. Try again.' },
      { status: 500 },
    );
  }
  let publicScoring = verdictToPublicStatus(verdict);
  if (categoryLeaksAnswer && publicScoring.publicStatus !== 'rejected') {
    publicScoring = {
      publicStatus: 'rejected',
      publicEligibilityScore: publicScoring.publicEligibilityScore,
      publicEligibilityReason: 'category_leaks_answer',
    };
  }
  console.info('[questions/vet]', {
    userId: session.userId,
    verdictStatus: verdict.status,
    overallScore: publicScoring.publicEligibilityScore,
    publicStatus: publicScoring.publicStatus,
    categoryLeaksAnswer,
  });

  const categorizedQuestionFields = {
    ...questionFields,
    difficulty: difficultyAssessment.difficulty,
    insideJoke,
  };

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

  const created = await createQuestion({
    authorId: session.userId,
    ...categorizedQuestionFields,
    publicStatus: publicScoring.publicStatus,
    publicEligibilityScore: publicScoring.publicEligibilityScore,
    publicEligibilityReason: publicScoring.publicEligibilityReason,
  });
  console.info('[questions/create]', { questionId: created.id, userId: session.userId, verified: categorizedQuestionFields.verified, category: categorizedQuestionFields.category, canonicalSubcategory: categorizedQuestionFields.canonicalSubcategory, difficultyTier: difficultyAssessment.tier });
  const feedShare = {
    requested: shareToFeed,
    createdCount: 0,
    friendCount: 0,
    sharedRecipientIds: [] as string[],
    skippedDismissedDomainRecipientIds: [] as string[],
    skippedExistingFeedRecipientIds: [] as string[],
  };

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
        // 'authored_shared' backs the "share to all friends" checkbox in the question
        // creation UI — this is an active feature, not a legacy write path.
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
    feedShare.friendCount = friends.length;
    feedShare.sharedRecipientIds = sharedRecipientIds;
    feedShare.skippedDismissedDomainRecipientIds = skippedDismissedDomainRecipientIds;
    feedShare.skippedExistingFeedRecipientIds = skippedExistingFeedRecipientIds;

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

  let openedDomain: string | null = null;
  try {
    const kbResult = await openKBDomain({
      userId: session.userId,
      domain: categorizedQuestionFields.canonicalSubcategory,
      via: 'authorship',
      broadCategory: categorizedQuestionFields.broadCategory,
      questionId: created.id,
    });
    openedDomain = kbResult.opened ? categorizedQuestionFields.canonicalSubcategory : null;
  } catch (error) {
    console.error('[questions/create] openKBDomain failed after question save/share; continuing response', {
      questionId: created.id,
      userId: session.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const question = await getQuestion(created.id, session.userId);

  return NextResponse.json(
    {
      ...created,
      question,
      ...(question ?? {}),
      openedDomain,
      feedShare,
    },
    { status: 201 },
  );
}
