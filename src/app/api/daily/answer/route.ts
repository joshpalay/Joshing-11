import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { gradeAnswer, selectQuip } from '@/server/grading';
import { updateDomainDifficultyOnAnswer } from '@/server/adaptive-difficulty';
import { getSession } from '@/server/auth/session';
import {
  dailyQueues,
  db,
  generatedQuestions,
  questions,
} from '@/server/db';
import { generateBreadcrumb } from '@/server/daily/generate-breadcrumb';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { promoteDeclaredToDemonstrated } from '@/server/knowledge/open-domain';
import { persistGeneratedQuestion } from '@/server/questions/persist-generated-question';
import { type QueueSlot } from '@/server/daily/types';

export const dynamic = 'force-dynamic';

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

function errorResponse(error: string, message: string, status: number) {
  return NextResponse.json({ error, message }, { status });
}

function parseBody(value: unknown): { queueId: string; slotIndex: number; submittedAnswer: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const queueId = typeof record.queue_id === 'string' ? record.queue_id : null;
  const slotIndex = typeof record.slot_index === 'number' && Number.isInteger(record.slot_index)
    ? record.slot_index
    : null;
  const submittedAnswer = typeof record.submitted_answer === 'string'
    ? record.submitted_answer.trim()
    : typeof record.answer === 'string'
      ? record.answer.trim()
      : null;

  if (!queueId || slotIndex === null || !submittedAnswer) return null;
  return { queueId, slotIndex, submittedAnswer };
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return errorResponse('unauthorized', "Please sign in to answer today's question.", 401);

    const parsed = parseBody(await request.json().catch(() => null));
    if (!parsed) {
      return errorResponse('validation', 'queue_id, slot_index, and submitted_answer are required', 400);
    }

    const [queue] = await db
      .select()
      .from(dailyQueues)
      .where(and(eq(dailyQueues.id, parsed.queueId), eq(dailyQueues.userId, session.userId)))
      .limit(1);

    if (!queue) return errorResponse('not_found', "We could not find today's Daily Five.", 404);

    const slots = asQueueSlots(queue.slots);
    const slot = slots[parsed.slotIndex];
    if (!slot) {
      return errorResponse('validation', 'slot_index out of range', 400);
    }
    if (slot.answered || slot.skipped) {
      return errorResponse('invalid_state', 'slot is already closed', 400);
    }
    if (!slot.generated_question_id) {
      return errorResponse('invalid_state', 'daily slot has no generated question', 400);
    }

    const [question] = await db
      .select()
      .from(generatedQuestions)
      .where(and(
        eq(generatedQuestions.id, slot.generated_question_id),
        eq(generatedQuestions.userId, session.userId),
      ))
      .limit(1);

    if (!question) return errorResponse('question_not_found', 'We could not find that Daily Five question.', 404);

    const grade = await gradeAnswer(
      parsed.submittedAnswer,
      question.answer,
      [],
      question.questionText,
      'factual',
    );
    const isCorrect = grade.result === 'correct';
    const pointsAwarded = isCorrect ? Math.round(question.basePoints) : 0;
    const answerState = isCorrect ? 'correct' : 'incorrect';
    const quip = selectQuip({ isCorrect, surface: 'daily', friendResult: null });
    const breadcrumb = await generateBreadcrumb({
      questionId: question.id,
      questionText: question.questionText,
      correctAnswer: question.answer,
      submittedAnswer: parsed.submittedAnswer,
      isCorrect,
      domain: question.canonicalSubcategory,
    }).catch(() => null);

    const nextSlots = slots.map((item, index) => {
      if (index !== parsed.slotIndex) return item;
      return {
        ...item,
        answered: true,
        answer_state: answerState,
        submitted_answer: parsed.submittedAnswer,
        awarded_points: pointsAwarded,
        reveal_canonical_answer: question.answer,
        reveal_explainer: question.explainer,
        reveal_breadcrumb: breadcrumb,
        reveal_quip: grade.consolation,
        quip,
      } satisfies QueueSlot;
    });

    await db
      .update(dailyQueues)
      .set({ slots: nextSlots })
      .where(eq(dailyQueues.id, queue.id));

    let masteryDelta = null;
    try {
      masteryDelta = await writeMasteryEvent({
        userId: session.userId,
        questionId: question.id,
        domain: question.canonicalSubcategory,
        answerState: isCorrect ? 'first_correct' : 'incorrect',
        pointsAwarded,
        sourceType: 'daily',
        sourceId: `${queue.id}:${parsed.slotIndex}`,
        broadCategory: question.broadCategory,
        eventQuestionId: null,
        basePoints: question.basePoints,
        weight: 1,
      });
    } catch (error) {
      console.warn('[daily/answer] writeMasteryEvent failed', error);
    }

    await updateDomainDifficultyOnAnswer(
      session.userId,
      question.canonicalSubcategory,
      isCorrect,
    ).catch((err) => {
      console.warn('[daily/answer] updateDomainDifficultyOnAnswer failed', err);
    });

    try {
      const persisted = await persistGeneratedQuestion(question.id);
      const [persistedQuestion] = await db
        .select({ creatorId: questions.creatorId, domain: questions.canonicalSubcategory, broadCategory: questions.broadCategory, category: questions.category })
        .from(questions)
        .where(eq(questions.id, persisted.questionId))
        .limit(1);
      const persistedDomain = persistedQuestion?.domain || persistedQuestion?.broadCategory || persistedQuestion?.category;

      if (isCorrect && persistedQuestion?.creatorId && persistedQuestion.creatorId !== session.userId && persistedDomain) {
        void promoteDeclaredToDemonstrated({
          userId: persistedQuestion.creatorId,
          domain: persistedDomain,
          triggeringFriendId: session.userId,
          questionId: persisted.questionId,
        });
      }

      void createFeedItemsForFriendsFromAnswer(
        session.userId,
        persisted.questionId,
        isCorrect ? 'correct' : 'incorrect',
      );
    } catch (error) {
      console.warn('[daily/answer] failed to persist generated question for feed propagation', {
        generatedQuestionId: question.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json({
      isCorrect,
      explanation: question.explainer,
      pointsAwarded,
      answerState,
      breadcrumb,
      masteryDelta,
      correctAnswer: question.answer,
      consolation: grade.consolation,
      correct: isCorrect,
      answer: question.answer,
      explainer: question.explainer,
      awarded_points: pointsAwarded,
      mastery_delta: masteryDelta,
      quip,
    });
  } catch (error) {
    console.error('[daily/answer] unexpected failure', error);
    return errorResponse('unexpected', 'Something went wrong while recording that answer.', 500);
  }
}
