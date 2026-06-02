import { eq } from 'drizzle-orm';
import { after, NextRequest } from 'next/server';

import { gradeAnswer } from '@/server/grading';
import { updateDomainDifficultyOnAnswer } from '@/server/adaptive-difficulty';
import { getSession } from '@/server/auth/session';
import { dailyQueues, db, feedItems, questions } from '@/server/db';
import { getCatchupQuestions, type CatchupQuestion } from '@/server/db/queries/daily';
import {
  asQueueSlots,
  findQueueSlotBySlotIndex,
  parseCatchupItemId,
  replaceQueueSlot,
} from '@/server/daily/catchup';
import { type QueueSlot } from '@/server/daily/types';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { awardAuthorCredit } from '@/server/mastery/author-credit';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { promoteDeclaredToDemonstrated } from '@/server/knowledge/open-domain';
import { persistGeneratedQuestion } from '@/server/questions/persist-generated-question';
import { catchUpErrorResponse } from '@/server/play/catch-up-submit-error';
import { computeAnswerState } from '@/server/answer-state';
import { readPriorAnswersForQuestion } from '@/server/answer-history';
import {
  CATCHUP_SURFACE_WEIGHT,
  RECOVERY_STATE_WEIGHT,
} from '@/server/mastery/constants';

export const dynamic = 'force-dynamic';

function parseBody(value: unknown): { dailyQueueItemId: string; submittedAnswer: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const dailyQueueItemId = typeof record.dailyQueueItemId === 'string' ? record.dailyQueueItemId : null;
  const submittedAnswer = typeof record.submittedAnswer === 'string' ? record.submittedAnswer.trim() : null;
  if (!dailyQueueItemId || !submittedAnswer) return null;
  return { dailyQueueItemId, submittedAnswer };
}

function nextItemPayload(item: CatchupQuestion | null) {
  if (!item) return null;
  return {
    dailyQueueItemId: item.dailyQueueItemId,
    questionId: item.questionId,
    questionText: item.questionText,
    correctAnswer: item.correctAnswer,
    alternateAnswers: item.alternateAnswers,
    explanation: item.explanation,
    domain: item.domain,
    domainDisplayName: item.domainDisplayName,
    queueDate: item.queueDate,
    queueAge: item.queueAge,
    wasSkipped: item.wasSkipped,
    expiresAt: item.expiresAt,
    expiresSoon: item.expiresSoon,
    difficultyEstimate: item.difficultyEstimate,
    authorName: item.authorName,
  };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return catchUpErrorResponse(401, 'unauthorized');

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return catchUpErrorResponse(400, 'validation', 'dailyQueueItemId and submittedAnswer are required');
  }

  const catchupItem = (await getCatchupQuestions(session.userId))
    .find((item) => item.dailyQueueItemId === parsed.dailyQueueItemId);
  if (!catchupItem) {
    return catchUpErrorResponse(404, 'assignment_not_found', 'Catch-up question not found', {
      refresh_required: true,
    });
  }

  if (catchupItem.surface === 'feed') {
    return handleFeedCatchupAnswer({
      userId: session.userId,
      submittedAnswer: parsed.submittedAnswer,
      catchupItem,
    });
  }

  return handleDailyCatchupAnswer({
    userId: session.userId,
    submittedAnswer: parsed.submittedAnswer,
    catchupItem,
  });
}

async function handleDailyCatchupAnswer({
  userId,
  submittedAnswer,
  catchupItem,
}: {
  userId: string;
  submittedAnswer: string;
  catchupItem: CatchupQuestion;
}) {
  if (catchupItem.queueId === null || catchupItem.slotIndex === null) {
    return catchUpErrorResponse(500, 'invalid_state', 'Daily catch-up item missing queue reference');
  }

  const [queue] = await db
    .select()
    .from(dailyQueues)
    .where(eq(dailyQueues.id, catchupItem.queueId))
    .limit(1);
  if (!queue || queue.userId !== userId) {
    return catchUpErrorResponse(404, 'assignment_not_found', 'Catch-up question not found', {
      refresh_required: true,
    });
  }

  const slots = asQueueSlots(queue.slots);
  const slot = findQueueSlotBySlotIndex(slots, catchupItem.slotIndex);
  if (!slot || slot.dismissed_at) {
    return catchUpErrorResponse(400, 'catch_up_not_eligible', 'catch-up item is already closed', {
      refresh_required: true,
    });
  }
  // A slot previously answered correctly is not eligible — only wrong/skipped/
  // untouched slots show up in catch-up after the expanded eligibility rules.
  if (slot.answered && slot.answer_state !== 'incorrect') {
    return catchUpErrorResponse(400, 'catch_up_not_eligible', 'catch-up item is already closed', {
      refresh_required: true,
    });
  }

  const grade = await gradeAnswer(
    submittedAnswer,
    catchupItem.correctAnswer,
    catchupItem.alternateAnswers,
    catchupItem.questionText,
    'factual',
  );
  const isCorrect = grade.result === 'correct';
  const answerState = isCorrect ? 'correct' : 'incorrect';

  // Promote the bot question to a canonical row BEFORE writing the mastery
  // event so cross-surface dedup can key on the canonical Question.id
  // (F2.2 — same shape as F2.1 in the live Daily route). Friend-authored
  // slots already live in the canonical table, so we resolve creator info
  // directly without going through persistGeneratedQuestion.
  let canonicalQuestionId: string | null = null;
  let persistedCreatorId: string | null = null;
  let persistedDomainForCreator: string | null = null;

  // Friend and house (D-3) slots both already live in the canonical `questions`
  // table — resolve by question_id rather than promoting a GeneratedQuestion.
  // House questions carry creatorId=null, so persistedCreatorId stays null and
  // no author credit accrues (house is mastery-ineligible by construction).
  if (slot.source === 'friend' || slot.source === 'house') {
    if (!slot.question_id) {
      return catchUpErrorResponse(500, 'invalid_state', 'Canonical catch-up slot missing question id');
    }
    canonicalQuestionId = slot.question_id;
    const [canonicalRow] = await db
      .select({
        creatorId: questions.creatorId,
        domain: questions.canonicalSubcategory,
        broadCategory: questions.broadCategory,
        category: questions.category,
      })
      .from(questions)
      .where(eq(questions.id, slot.question_id))
      .limit(1);
    persistedCreatorId = canonicalRow?.creatorId ?? null;
    persistedDomainForCreator =
      canonicalRow?.domain || canonicalRow?.broadCategory || canonicalRow?.category || null;
  } else {
    let persistAttempt = 0;
    while (persistAttempt < 2 && canonicalQuestionId === null) {
      persistAttempt += 1;
      try {
        const persisted = await persistGeneratedQuestion(catchupItem.questionId, catchupItem.domain);
        canonicalQuestionId = persisted.questionId;
        const [persistedQuestion] = await db
          .select({ creatorId: questions.creatorId, domain: questions.canonicalSubcategory, broadCategory: questions.broadCategory, category: questions.category })
          .from(questions)
          .where(eq(questions.id, persisted.questionId))
          .limit(1);
        persistedCreatorId = persistedQuestion?.creatorId ?? null;
        persistedDomainForCreator =
          persistedQuestion?.domain || persistedQuestion?.broadCategory || persistedQuestion?.category || null;
      } catch (error) {
        const finalAttempt = persistAttempt >= 2;
        console.warn(
          finalAttempt
            ? '[daily/catchup/answer] persistGeneratedQuestion failed after retry; canonical id will be backfilled later'
            : '[daily/catchup/answer] persistGeneratedQuestion failed; retrying once',
          {
            generatedQuestionId: catchupItem.questionId,
            attempt: persistAttempt,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
  }

  const priorAnswers = canonicalQuestionId
    ? await readPriorAnswersForQuestion(userId, canonicalQuestionId)
    : [];
  const masteryAnswerState = computeAnswerState(
    isCorrect ? 'correct' : 'wrong',
    priorAnswers,
  );

  const baseCatchupPoints = Math.round(catchupItem.basePoints * CATCHUP_SURFACE_WEIGHT);
  const pointsAwarded =
    masteryAnswerState === 'first_correct'
      ? baseCatchupPoints
      : masteryAnswerState === 'first_correct_after_wrong'
        // Recovery on a catch-up answer = 25% of the original live base (not 6.25%).
        // RECOVERY_STATE_WEIGHT applies to the full base, not the already-reduced
        // catch-up base, so wrong-then-right on catch-up still earns meaningful credit.
        ? Math.round(catchupItem.basePoints * RECOVERY_STATE_WEIGHT)
        : 0;

  const nextSlots = replaceQueueSlot(slots, catchupItem.slotIndex, (item) => {
    return {
      ...item,
      answered: true,
      answer_state: answerState,
      submitted_answer: submittedAnswer,
      awarded_points: pointsAwarded,
      reveal_canonical_answer: catchupItem.correctAnswer,
      reveal_explainer: catchupItem.explanation ?? '',
      reveal_quip: grade.consolation,
      // Drop any breadcrumb persisted from the original (often wrong) live
      // answer. This slot is being re-answered in catch-up, so the old
      // breadcrumb no longer matches the submitted answer or verdict; leaving
      // it would make /api/breadcrumb short-circuit on the stale value and
      // render a correction for an answer the user never gave this turn.
      reveal_breadcrumb: null,
    } satisfies QueueSlot;
  });

  let masteryDelta = null;
  try {
    masteryDelta = await writeMasteryEvent({
      userId,
      questionId: catchupItem.questionId,
      domain: catchupItem.domain,
      answerState: masteryAnswerState,
      pointsAwarded,
      sourceType: 'catchup',
      sourceId: catchupItem.dailyQueueItemId,
      broadCategory: catchupItem.broadCategory,
      eventQuestionId: canonicalQuestionId,
      basePoints: catchupItem.basePoints,
      weight: catchupItem.basePoints > 0 ? pointsAwarded / catchupItem.basePoints : 0,
    });
  } catch (error) {
    // Cross-surface dedupe: the unique key on (source_type, question_id,
    // answered_by_user_id) can fire when the same canonical question
    // resurfaces via a different generated/queue slot. Mirror the live
    // daily/answer route and let the rest of the submission complete.
    console.warn('[daily/catchup/answer] writeMasteryEvent failed', error);
  }

  await db
    .update(dailyQueues)
    .set({ slots: nextSlots })
    .where(eq(dailyQueues.id, queue.id));

  await updateDomainDifficultyOnAnswer(
    userId,
    catchupItem.domain,
    isCorrect,
  ).catch((err) => {
    console.warn('[daily/catchup/answer] updateDomainDifficultyOnAnswer failed', err);
  });

  if (canonicalQuestionId) {
    try {
      if (isCorrect && persistedCreatorId && persistedCreatorId !== userId && persistedDomainForCreator) {
        void promoteDeclaredToDemonstrated({
          userId: persistedCreatorId,
          domain: persistedDomainForCreator,
          triggeringFriendId: userId,
          questionId: canonicalQuestionId,
        });

        // Author credit (PRD §8.32): off the user's hot path.
        void awardAuthorCredit({
          creatorUserId: persistedCreatorId,
          answererUserId: userId,
          questionId: canonicalQuestionId,
          domain: persistedDomainForCreator,
          sourceId: `catchup:${catchupItem.dailyQueueItemId}:${userId}`,
          scope: 'daily/catchup/answer',
        });
      }

      after(() => createFeedItemsForFriendsFromAnswer(
        userId,
        canonicalQuestionId,
        isCorrect ? 'correct' : 'incorrect',
        `catchup:${catchupItem.dailyQueueItemId}:${userId}`,
      ));
    } catch (error) {
      console.warn('[daily/catchup/answer] feed propagation failed', {
        generatedQuestionId: catchupItem.questionId,
        canonicalQuestionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const nextItem = (await getCatchupQuestions(userId))[0] ?? null;

  return Response.json({
    dailyQueueItemId: catchupItem.dailyQueueItemId,
    questionId: catchupItem.questionId,
    result: grade.result,
    isCorrect,
    correct: isCorrect,
    pointsAwarded,
    answerState,
    breadcrumb: null,
    awarded_points: pointsAwarded,
    masteryDelta,
    mastery_delta: masteryDelta,
    correctAnswer: catchupItem.correctAnswer,
    answer: catchupItem.correctAnswer,
    explanation: catchupItem.explanation,
    explainer: catchupItem.explanation,
    consolation: grade.consolation,
    nextItem: nextItemPayload(nextItem),
  });
}

async function handleFeedCatchupAnswer({
  userId,
  submittedAnswer,
  catchupItem,
}: {
  userId: string;
  submittedAnswer: string;
  catchupItem: CatchupQuestion;
}) {
  if (!catchupItem.feedItemId) {
    return catchUpErrorResponse(500, 'invalid_state', 'Feed catch-up item missing feed reference');
  }
  const parsedId = parseCatchupItemId(catchupItem.dailyQueueItemId);
  if (parsedId?.surface !== 'feed') {
    return catchUpErrorResponse(500, 'invalid_state', 'Feed catch-up item id malformed');
  }

  // Re-verify the feed item still exists and is still eligible. We pulled it
  // via getCatchupQuestions, but a concurrent feed answer/dismiss could have
  // resolved it between the read and now.
  const [feedRow] = await db
    .select({ feedItem: feedItems, question: questions })
    .from(feedItems)
    .innerJoin(questions, eq(feedItems.questionId, questions.id))
    .where(eq(feedItems.id, catchupItem.feedItemId))
    .limit(1);
  if (!feedRow || feedRow.feedItem.recipientUserId !== userId) {
    return catchUpErrorResponse(404, 'assignment_not_found', 'Catch-up question not found', {
      refresh_required: true,
    });
  }
  if (feedRow.feedItem.catchupResolvedAt) {
    return catchUpErrorResponse(400, 'catch_up_not_eligible', 'catch-up item is already closed', {
      refresh_required: true,
    });
  }

  const grade = await gradeAnswer(
    submittedAnswer,
    catchupItem.correctAnswer,
    catchupItem.alternateAnswers,
    catchupItem.questionText,
    feedRow.question.questionType,
  );
  const isCorrect = grade.result === 'correct';
  const answerState = isCorrect ? 'correct' : 'incorrect';

  const priorAnswers = await readPriorAnswersForQuestion(userId, feedRow.question.id);
  const masteryAnswerState = computeAnswerState(
    isCorrect ? 'correct' : 'wrong',
    priorAnswers,
  );

  const baseCatchupPoints = Math.round(catchupItem.basePoints * CATCHUP_SURFACE_WEIGHT);
  const pointsAwarded =
    masteryAnswerState === 'first_correct'
      ? baseCatchupPoints
      : masteryAnswerState === 'first_correct_after_wrong'
        ? Math.round(catchupItem.basePoints * RECOVERY_STATE_WEIGHT)
        : 0;

  let masteryDelta = null;
  try {
    masteryDelta = await writeMasteryEvent({
      userId,
      questionId: feedRow.question.id,
      domain: catchupItem.domain,
      answerState: masteryAnswerState,
      pointsAwarded,
      sourceType: 'catchup',
      sourceId: catchupItem.dailyQueueItemId,
      broadCategory: catchupItem.broadCategory,
      eventQuestionId: feedRow.question.id,
      basePoints: catchupItem.basePoints,
      weight: catchupItem.basePoints > 0 ? pointsAwarded / catchupItem.basePoints : 0,
    });
  } catch (error) {
    // See note in handleDailyCatchupAnswer: tolerate cross-surface dedupe
    // conflicts on the (source_type, question_id, answered_by_user_id) key.
    console.warn('[daily/catchup/answer] writeMasteryEvent (feed) failed', error);
  }

  // Resolve the feed item so it stops surfacing in catch-up. We only flip
  // answerResult to 'correct' on recovery; the original feed-card history
  // (state='answered', submittedAnswer) stays put so the user can still see
  // what they originally typed.
  await db
    .update(feedItems)
    .set({
      catchupResolvedAt: new Date(),
      ...(isCorrect ? { answerResult: 'correct' as const, pointsAwarded } : {}),
    })
    .where(eq(feedItems.id, feedRow.feedItem.id));

  await updateDomainDifficultyOnAnswer(userId, catchupItem.domain, isCorrect).catch((err) => {
    console.warn('[daily/catchup/answer] updateDomainDifficultyOnAnswer (feed) failed', err);
  });

  // Promote author's declared territory + author credit on first recovery,
  // mirroring the daily path. Skipped for self-authored questions.
  if (isCorrect && feedRow.question.creatorId && feedRow.question.creatorId !== userId) {
    void promoteDeclaredToDemonstrated({
      userId: feedRow.question.creatorId,
      domain: catchupItem.domain,
      triggeringFriendId: userId,
      questionId: feedRow.question.id,
    });
    void awardAuthorCredit({
      creatorUserId: feedRow.question.creatorId,
      answererUserId: userId,
      questionId: feedRow.question.id,
      domain: catchupItem.domain,
      sourceId: `catchup:${catchupItem.dailyQueueItemId}:${userId}`,
      scope: 'daily/catchup/answer',
    });
  }

  if (isCorrect) {
    after(() => createFeedItemsForFriendsFromAnswer(
      userId,
      feedRow.question.id,
      'correct',
      `catchup:${catchupItem.dailyQueueItemId}:${userId}`,
    ));
  }

  const nextItem = (await getCatchupQuestions(userId))[0] ?? null;

  return Response.json({
    dailyQueueItemId: catchupItem.dailyQueueItemId,
    questionId: feedRow.question.id,
    result: grade.result,
    isCorrect,
    correct: isCorrect,
    pointsAwarded,
    answerState,
    breadcrumb: null,
    awarded_points: pointsAwarded,
    masteryDelta,
    mastery_delta: masteryDelta,
    correctAnswer: catchupItem.correctAnswer,
    answer: catchupItem.correctAnswer,
    explanation: catchupItem.explanation,
    explainer: catchupItem.explanation,
    consolation: grade.consolation,
    nextItem: nextItemPayload(nextItem),
  });
}
