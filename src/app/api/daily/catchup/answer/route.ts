import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';

import { gradeAnswer, selectQuip } from '@/server/grading';
import { updateDomainDifficultyOnAnswer } from '@/server/adaptive-difficulty';
import { getSession } from '@/server/auth/session';
import { dailyQueues, db } from '@/server/db';
import { getCatchupQuestions } from '@/server/db/queries/daily';
import { asQueueSlots, findQueueSlotBySlotIndex, replaceQueueSlot } from '@/server/daily/catchup';
import { generateBreadcrumb } from '@/server/daily/generate-breadcrumb';
import { type QueueSlot } from '@/server/daily/types';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { catchUpErrorResponse } from '@/server/play/catch-up-submit-error';

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
  const pointsAwarded = isCorrect ? Math.round(catchupItem.basePoints * 0.25) : 0;
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
    answerState: isCorrect ? 'first_correct' : 'incorrect',
    pointsAwarded,
    sourceType: 'catchup',
    sourceId: parsed.dailyQueueItemId,
    broadCategory: catchupItem.broadCategory,
    eventQuestionId: null,
    basePoints: catchupItem.basePoints,
    weight: isCorrect ? 0.25 : 0,
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

  void createFeedItemsForFriendsFromAnswer(
    session.userId,
    catchupItem.questionId,
    isCorrect ? 'correct' : 'incorrect',
  );

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
