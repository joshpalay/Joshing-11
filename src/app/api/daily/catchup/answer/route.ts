import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';

import { gradeAnswer, selectQuip } from '@/server/grading';
import { updateDomainDifficultyOnAnswer } from '@/server/adaptive-difficulty';
import { getSession } from '@/server/auth/session';
import { dailyQueues, db, questions } from '@/server/db';
import { getCatchupQuestions } from '@/server/db/queries/daily';
import { asQueueSlots, findQueueSlotBySlotIndex, replaceQueueSlot } from '@/server/daily/catchup';
import { generateBreadcrumb } from '@/server/daily/generate-breadcrumb';
import { type QueueSlot } from '@/server/daily/types';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { creatorMasteryAwardForNthCorrect } from '@/server/mastery/scoring';
import { countAuthorCreditEvents } from '@/server/mastery/author-credit';
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

  const [queue] = await db
    .select()
    .from(dailyQueues)
    .where(eq(dailyQueues.id, catchupItem.queueId))
    .limit(1);
  if (!queue || queue.userId !== session.userId) {
    return catchUpErrorResponse(404, 'assignment_not_found', 'Catch-up question not found', {
      refresh_required: true,
    });
  }

  const slots = asQueueSlots(queue.slots);
  const slot = findQueueSlotBySlotIndex(slots, catchupItem.slotIndex);
  if (!slot || slot.answered || slot.dismissed_at) {
    return catchUpErrorResponse(400, 'catch_up_not_eligible', 'catch-up item is already closed', {
      refresh_required: true,
    });
  }

  const grade = await gradeAnswer(
    parsed.submittedAnswer,
    catchupItem.correctAnswer,
    catchupItem.alternateAnswers,
    catchupItem.questionText,
    'factual',
  );
  const isCorrect = grade.result === 'correct';
  const answerState = isCorrect ? 'correct' : 'incorrect';
  const quip = selectQuip({ isCorrect, surface: 'daily', friendResult: null });
  const breadcrumb = await generateBreadcrumb({
    questionId: catchupItem.questionId,
    questionText: catchupItem.questionText,
    correctAnswer: catchupItem.correctAnswer,
    submittedAnswer: parsed.submittedAnswer,
    isCorrect,
    domain: catchupItem.domain,
  }).catch(() => null);

  // Promote the bot question to a canonical row BEFORE writing the mastery
  // event so cross-surface dedup can key on the canonical Question.id
  // (F2.2 — same shape as F2.1 in the live Daily route).
  let canonicalQuestionId: string | null = null;
  let persistedCreatorId: string | null = null;
  let persistedDomainForCreator: string | null = null;
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
    console.warn('[daily/catchup/answer] failed to persist generated question; mastery event will skip canonical id', {
      generatedQuestionId: catchupItem.questionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const priorAnswers = canonicalQuestionId
    ? await readPriorAnswersForQuestion(session.userId, canonicalQuestionId)
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
      submitted_answer: parsed.submittedAnswer,
      awarded_points: pointsAwarded,
      reveal_canonical_answer: catchupItem.correctAnswer,
      reveal_explainer: catchupItem.explanation ?? '',
      reveal_breadcrumb: breadcrumb,
      reveal_quip: grade.consolation,
      quip,
    } satisfies QueueSlot;
  });

  const masteryDelta = await writeMasteryEvent({
    userId: session.userId,
    questionId: catchupItem.questionId,
    domain: catchupItem.domain,
    answerState: masteryAnswerState,
    pointsAwarded,
    sourceType: 'catchup',
    sourceId: parsed.dailyQueueItemId,
    broadCategory: catchupItem.broadCategory,
    eventQuestionId: canonicalQuestionId,
    basePoints: catchupItem.basePoints,
    weight: catchupItem.basePoints > 0 ? pointsAwarded / catchupItem.basePoints : 0,
  });

  await db
    .update(dailyQueues)
    .set({ slots: nextSlots })
    .where(eq(dailyQueues.id, catchupItem.queueId));

  await updateDomainDifficultyOnAnswer(
    session.userId,
    catchupItem.domain,
    isCorrect,
  ).catch((err) => {
    console.warn('[daily/catchup/answer] updateDomainDifficultyOnAnswer failed', err);
  });

  if (canonicalQuestionId) {
    try {
      if (isCorrect && persistedCreatorId && persistedCreatorId !== session.userId && persistedDomainForCreator) {
        void promoteDeclaredToDemonstrated({
          userId: persistedCreatorId,
          domain: persistedDomainForCreator,
          triggeringFriendId: session.userId,
          questionId: canonicalQuestionId,
        });

        // Author credit: windowed scheme, Moderate/Specialist only (PRD §8.32).
        const [canonicalQ] = await db
          .select({ calibratedDifficulty: questions.calibratedDifficulty, llmDifficulty: questions.llmDifficulty, correctCount: questions.correctCount, askedCount: questions.askedCount })
          .from(questions)
          .where(eq(questions.id, canonicalQuestionId))
          .limit(1);
        if (canonicalQ) {
          const existingCredits = await countAuthorCreditEvents(canonicalQuestionId, persistedCreatorId);
          const authorAward = creatorMasteryAwardForNthCorrect(
            canonicalQ.correctCount,
            canonicalQ.askedCount,
            existingCredits + 1,
            canonicalQ.calibratedDifficulty ?? canonicalQ.llmDifficulty,
          );
          if (authorAward.awardedPoints > 0) {
            await writeMasteryEvent({
              userId: persistedCreatorId,
              questionId: canonicalQuestionId,
              domain: persistedDomainForCreator,
              pointsAwarded: authorAward.awardedPoints,
              sourceType: 'author_credit',
              sourceId: `catchup:${catchupItem.dailyQueueItemId}:${session.userId}`,
              broadCategory: undefined,
              eventQuestionId: canonicalQuestionId,
              basePoints: authorAward.basePoints,
              weight: authorAward.weight,
              answeredByUserId: session.userId,
            }).catch((err) => {
              console.warn('[daily/catchup/answer] author_credit write failed', err);
            });
          }
        }
      }

      await createFeedItemsForFriendsFromAnswer(
        session.userId,
        canonicalQuestionId,
        isCorrect ? 'correct' : 'incorrect',
        `catchup:${catchupItem.dailyQueueItemId}:${session.userId}`,
      );
    } catch (error) {
      console.warn('[daily/catchup/answer] feed propagation failed', {
        generatedQuestionId: catchupItem.questionId,
        canonicalQuestionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const nextItem = (await getCatchupQuestions(session.userId))[0] ?? null;

  return Response.json({
    dailyQueueItemId: catchupItem.dailyQueueItemId,
    questionId: catchupItem.questionId,
    result: grade.result,
    isCorrect,
    correct: isCorrect,
    pointsAwarded,
    answerState,
    breadcrumb,
    awarded_points: pointsAwarded,
    masteryDelta,
    mastery_delta: masteryDelta,
    correctAnswer: catchupItem.correctAnswer,
    answer: catchupItem.correctAnswer,
    explanation: catchupItem.explanation,
    explainer: catchupItem.explanation,
    consolation: grade.consolation,
    quip,
    nextItem: nextItem
      ? {
          dailyQueueItemId: nextItem.dailyQueueItemId,
          questionId: nextItem.questionId,
          questionText: nextItem.questionText,
          correctAnswer: nextItem.correctAnswer,
          alternateAnswers: nextItem.alternateAnswers,
          explanation: nextItem.explanation,
          domain: nextItem.domain,
          domainDisplayName: nextItem.domainDisplayName,
          queueDate: nextItem.queueDate,
          queueAge: nextItem.queueAge,
          wasSkipped: nextItem.wasSkipped,
          expiresAt: nextItem.expiresAt,
          expiresSoon: nextItem.expiresSoon,
          difficultyEstimate: nextItem.difficultyEstimate,
        }
      : null,
  });
}
