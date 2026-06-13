import { and, eq, inArray, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { broadCategoryDisplayName, normalizeBroadQuestionCategoryOrDefault, normalizeCanonicalSubcategory } from '@/lib/question-categorization';
import { categorizeQuestion, generateInsideJoke } from '@/lib/llm';
import { verdictToPublicStatus, vetQuestion } from '@/server/llm/vet-question';
// Imported from vet-verdict (not vet-question) so it resolves to the real
// pure mapper even where vet-question is mocked.
import { verdictToBlockedVisibility } from '@/server/llm/vet-verdict';
import { getSession } from '@/server/auth/session';
import { db, feedDismissedDomains, feedItems, questions, users } from '@/server/db';
import {
  createQuestion,
  getQuestion,
  getQuestionsForUser,
} from '@/server/db/queries/questions';
import { getFollowers, getFriends } from '@/server/db/queries/friends';
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
import { assessQuestionDifficulty, fallbackQuestionDifficulty } from '@/server/questions/llm-difficulty';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';
import { isReconcileAuthoredDomainsEnabled, reconcileAuthoredDomain } from '@/server/questions/reconcile-authored-domain';

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
    if (errors.includes('unverifiedBroadcast')) {
      return NextResponse.json(
        {
          error: 'unverified_no_broadcast',
          fields: errors,
          message: "This question isn't verified, so it can only be sent directly to specific friends — not shared with all friends.",
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
  // B-CATEGORY-AUTHORED-RECONCILE-01: the authored path historically wrote the
  // blind categorizer label, unlike the generated/onboarding paths which
  // reconcile against existing domains. Fold the proposal onto an existing
  // domain (C: trgm-exact first, Haiku on miss; silent) so an authored "Hamlet"
  // reuses the player's "Shakespearean Tragedy" instead of minting a sibling.
  //
  // Phase 1 ships flag-OFF: we ALWAYS compute + shadow-log the outcome to
  // quantify pre-fix duplication, but only ADOPT it when RECONCILE_AUTHORED_DOMAINS
  // is enabled — flag-off is a strict no-op on the written label.
  const reconcileOutcome = await reconcileAuthoredDomain(normalizedSubcategory, session.userId);
  const reconcileFlagEnabled = isReconcileAuthoredDomainsEnabled();
  // Preserve the F4.5 write-boundary guard: never adopt a reconciled label the
  // guard would reject — fall through to the already-validated proposed label
  // rather than letting createQuestion throw.
  const reconciledTooGeneric =
    reconcileOutcome.differs && isGenericSubcategory(reconcileOutcome.canonicalDomain);
  const applyReconcile = reconcileFlagEnabled && reconcileOutcome.differs && !reconciledTooGeneric;
  console.info('[questions/authored-reconcile]', {
    userId: session.userId,
    proposed: normalizedSubcategory,
    reconciled: reconcileOutcome.canonicalDomain,
    differs: reconcileOutcome.differs,
    method: reconcileOutcome.method,
    trgmExact: reconcileOutcome.trgmExactLabel,
    trgmFuzzy: reconcileOutcome.trgmFuzzyCandidates,
    llmReconciled: reconcileOutcome.llmReconciled,
    flagEnabled: reconcileFlagEnabled,
    reconciledTooGeneric,
    applied: applyReconcile,
  });
  // broad_category is intentionally kept from the categorizer (matches the
  // generated path, which swaps only the domain label on reconcile); reconcile
  // does not emit a broad category.
  const canonicalSubcategory = applyReconcile ? reconcileOutcome.canonicalDomain : normalizedSubcategory;
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
  // sequencing dependency in this handler.
  //
  // Each of these is *optional* enrichment with its own degraded fallback
  // (difficulty → fallbackQuestionDifficulty(); inside joke → null; vet →
  // needs_review, which the /api/cron/vet-questions sweep retries). We use
  // allSettled rather than Promise.all so a single enrichment outage degrades
  // that one signal instead of rejecting the whole batch and 500ing the save.
  // The structural guarantee lives here, not in each helper's internal
  // try/catch discipline.
  const [difficultyResult, insideJokeResult, verdictResult] = await Promise.allSettled([
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

  const logEnrichmentFailure = (stage: string, reason: unknown) => {
    console.error('[questions/create] enrichment_degraded', {
      stage,
      userId: session.userId,
      message: reason instanceof Error ? reason.message : String(reason),
    });
  };

  if (difficultyResult.status === 'fulfilled') {
    difficultyAssessment = difficultyResult.value;
  } else {
    logEnrichmentFailure('difficulty', difficultyResult.reason);
    difficultyAssessment = fallbackQuestionDifficulty();
  }

  if (insideJokeResult.status === 'fulfilled') {
    insideJoke = insideJokeResult.value;
  } else {
    logEnrichmentFailure('inside_joke', insideJokeResult.reason);
    insideJoke = null;
  }

  if (verdictResult.status === 'fulfilled') {
    verdict = verdictResult.value;
  } else {
    // Failed vet falls back to needs_review (never auto-publishes) — the cron
    // sweep re-vets these at every visibility except 'blocked', so a question
    // fanned out below still gets a definitive safety verdict; if that verdict
    // is a safety fail, the cron hard-blocks it and the feed render predicate
    // retires the already-written rows. Mirrors vetQuestion's internal
    // llm_error path.
    logEnrichmentFailure('vet', verdictResult.reason);
    verdict = { status: 'needs_review' as const, score: null, reason: 'llm_error' };
  }
  let publicScoring = verdictToPublicStatus(verdict);
  // Safety-fail verdicts are hard-blocked from every surface: we override the
  // saved visibility to 'blocked' (a state questionVisibilityPredicate and all
  // bank/send/game read paths exclude) and skip ALL fan-out below. This is
  // safety-only — factual/quality/answer-leaked rejections stay publicStatus
  // signals and remain shareable to friends.
  const blockedVisibility = verdictToBlockedVisibility(verdict);
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
    // Override any user-chosen visibility on a safety hard-block. Placed after
    // the spread so it wins over categorizedQuestionFields.visibility.
    ...(blockedVisibility ? { visibility: blockedVisibility } : {}),
  });
  console.info('[questions/create]', { questionId: created.id, userId: session.userId, verified: categorizedQuestionFields.verified, category: categorizedQuestionFields.category, canonicalSubcategory: categorizedQuestionFields.canonicalSubcategory, difficultyTier: difficultyAssessment.tier });

  // Safety hard-block: short-circuit BEFORE any fan-out (broadcast + direct
  // send), KB-domain opening, and the success payload. The question is saved
  // as 'blocked' (in the author's bank, but unshareable) and must not reach any
  // recipient feed even in this same request. We do not name the triggered
  // category. Matches the existing creation-error response shape.
  if (blockedVisibility) {
    console.info('[questions/create] safety_blocked', { questionId: created.id, userId: session.userId });
    return NextResponse.json(
      {
        error: 'failed_content_check',
        message: "We couldn't publish or share that question because it didn't pass a content check.",
      },
      { status: 422 },
    );
  }
  const feedShare = {
    requested: shareToFeed,
    createdCount: 0,
    friendCount: 0,
    sharedRecipientIds: [] as string[],
    skippedDismissedDomainRecipientIds: [] as string[],
    skippedExistingFeedRecipientIds: [] as string[],
  };

  if (shareToFeed) {
    // Broadcast fan-out reaches my followers (people who follow me), not just
    // mutuals — directional follow model (D-1 Stage 3).
    const friends = await getFollowers(session.userId);
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
