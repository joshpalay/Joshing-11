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
import { creatorMasteryAwardForNthCorrect } from '@/server/mastery/scoring';
import { countAuthorCreditEvents } from '@/server/mastery/author-credit';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { promoteDeclaredToDemonstrated } from '@/server/knowledge/open-domain';
import { persistGeneratedQuestion } from '@/server/questions/persist-generated-question';
import { type QueueSlot } from '@/server/daily/types';
import { isGenericCanonicalAnswer, normalizeCanonicalAnswerLabel } from '@/server/answers/canonical-answer';
import { suggestAnswer } from '@/lib/llm';
import { computeAnswerState } from '@/server/answer-state';
import { readPriorAnswersForQuestion } from '@/server/answer-history';
import { RECOVERY_STATE_WEIGHT } from '@/server/mastery/constants';

export const dynamic = 'force-dynamic';

type DailyAnswerErrorCode =
  | 'unauthorized'
  | 'validation'
  | 'not_found'
  | 'invalid_state'
  | 'question_not_found'
  | 'unexpected';

function dailyAnswerErrorResponse(status: number, error: DailyAnswerErrorCode, message: string) {
  return NextResponse.json({ error, message }, { status });
}

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

async function resolveCanonicalAnswer(question: typeof generatedQuestions.$inferSelect): Promise<string> {
  const currentAnswer = normalizeCanonicalAnswerLabel(question.answer);
  if (!isGenericCanonicalAnswer(currentAnswer)) return currentAnswer;

  const suggestion = await suggestAnswer(question.questionText).catch((error) => {
    console.warn('[daily/answer] failed to repair generic canonical answer', {
      generatedQuestionId: question.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  const repairedAnswer = suggestion?.suggested_answer
    ? normalizeCanonicalAnswerLabel(suggestion.suggested_answer)
    : null;

  if (!repairedAnswer || isGenericCanonicalAnswer(repairedAnswer)) {
    return currentAnswer;
  }

  await db
    .update(generatedQuestions)
    .set({ answer: repairedAnswer })
    .where(eq(generatedQuestions.id, question.id))
    .catch((error) => {
      console.warn('[daily/answer] failed to persist repaired canonical answer', {
        generatedQuestionId: question.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return repairedAnswer;
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
    if (!session) {
      return dailyAnswerErrorResponse(401, 'unauthorized', "Please sign in to answer today's question.");
    }

    const parsed = parseBody(await request.json().catch(() => null));
    if (!parsed) {
      return dailyAnswerErrorResponse(400, 'validation', 'queue_id, slot_index, and submitted_answer are required');
    }

    const [queue] = await db
      .select()
      .from(dailyQueues)
      .where(and(eq(dailyQueues.id, parsed.queueId), eq(dailyQueues.userId, session.userId)))
      .limit(1);

    if (!queue) {
      return dailyAnswerErrorResponse(404, 'not_found', 'We could not find that Daily Five queue.');
    }

    const slots = asQueueSlots(queue.slots);
    const slot = slots.find((item) => item.slot_index === parsed.slotIndex);
    if (!slot) {
      return dailyAnswerErrorResponse(400, 'validation', 'slot_index out of range');
    }
    if (slot.answered || slot.skipped) {
      return dailyAnswerErrorResponse(400, 'invalid_state', 'That question is already closed.');
    }
    if (!slot.generated_question_id) {
      return dailyAnswerErrorResponse(400, 'invalid_state', 'That Daily Five slot is not ready yet.');
    }

    const [question] = await db
      .select()
      .from(generatedQuestions)
      .where(and(
        eq(generatedQuestions.id, slot.generated_question_id),
        eq(generatedQuestions.userId, session.userId),
      ))
      .limit(1);

    if (!question) {
      return dailyAnswerErrorResponse(404, 'question_not_found', 'We could not find that Daily Five question.');
    }

    const canonicalAnswer = await resolveCanonicalAnswer(question);

    const grade = await gradeAnswer(
      parsed.submittedAnswer,
      canonicalAnswer,
      [],
      question.questionText,
      'factual',
    );
    const isCorrect = grade.result === 'correct';
    const answerState = isCorrect ? 'correct' : 'incorrect';
    const quip = selectQuip({ isCorrect, surface: 'daily', friendResult: null });
    const breadcrumb = await generateBreadcrumb({
      questionId: question.id,
      questionText: question.questionText,
      correctAnswer: canonicalAnswer,
      submittedAnswer: parsed.submittedAnswer,
      isCorrect,
      domain: question.canonicalSubcategory,
    }).catch(() => null);

    // Promote the bot question to a canonical row BEFORE writing the mastery
    // event so cross-surface dedup can key on the canonical Question.id
    // (F2.1). If persistence fails the route still records the answer in the
    // queue and the user-visible result is unaffected; only mastery /
    // friend-feed propagation are skipped for this attempt.
    let canonicalQuestionId: string | null = null;
    let persistedCreatorId: string | null = null;
    let persistedDomainForCreator: string | null = null;
    try {
      const persisted = await persistGeneratedQuestion(question.id);
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
      console.warn('[daily/answer] failed to persist generated question; mastery event will skip canonical id', {
        generatedQuestionId: question.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Compute answer_state against masteryEvents history so first_correct
    // vs first_correct_after_wrong vs repeat_correct vs incorrect is
    // determined correctly across surfaces (F2.1). Falls back to the old
    // behaviour (treat as first attempt) only if persistence failed and we
    // have no canonical id to look up history against.
    const priorAnswers = canonicalQuestionId
      ? await readPriorAnswersForQuestion(session.userId, canonicalQuestionId)
      : [];
    const masteryAnswerState = computeAnswerState(
      isCorrect ? 'correct' : 'wrong',
      priorAnswers,
    );
    const basePoints = Math.round(question.basePoints);
    const pointsAwarded =
      masteryAnswerState === 'first_correct'
        ? basePoints
        : masteryAnswerState === 'first_correct_after_wrong'
          ? Math.round(basePoints * RECOVERY_STATE_WEIGHT)
          : 0;

    const nextSlots = slots.map((item) => {
      if (item.slot_index !== parsed.slotIndex) return item;
      return {
        ...item,
        answered: true,
        answer_state: answerState,
        submitted_answer: parsed.submittedAnswer,
        awarded_points: pointsAwarded,
        reveal_canonical_answer: canonicalAnswer,
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
        answerState: masteryAnswerState,
        pointsAwarded,
        sourceType: 'daily',
        sourceId: `${queue.id}:${parsed.slotIndex}`,
        broadCategory: question.broadCategory,
        eventQuestionId: canonicalQuestionId,
        basePoints,
        weight: pointsAwarded > 0 ? pointsAwarded / basePoints : 0,
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
          // We need the canonical question row to get difficulty and counts.
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
                sourceId: `daily:${question.id}:${session.userId}`,
                broadCategory: undefined,
                eventQuestionId: canonicalQuestionId,
                basePoints: authorAward.basePoints,
                weight: authorAward.weight,
                answeredByUserId: session.userId,
              }).catch((err) => {
                console.warn('[daily/answer] author_credit write failed', err);
              });
            }
          }
        }

        await createFeedItemsForFriendsFromAnswer(
          session.userId,
          canonicalQuestionId,
          isCorrect ? 'correct' : 'incorrect',
          `daily:${question.id}:${session.userId}`,
        );
      } catch (error) {
        console.warn('[daily/answer] feed propagation failed', {
          generatedQuestionId: question.id,
          canonicalQuestionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      isCorrect,
      explanation: question.explainer,
      pointsAwarded,
      answerState,
      breadcrumb,
      masteryDelta,
      correctAnswer: canonicalAnswer,
      consolation: grade.consolation,
      correct: isCorrect,
      answer: canonicalAnswer,
      explainer: question.explainer,
      awarded_points: pointsAwarded,
      mastery_delta: masteryDelta,
      quip,
    });
  } catch (error) {
    console.error('[daily/answer] unexpected failure', error);
    return dailyAnswerErrorResponse(500, 'unexpected', 'Could not record that answer.');
  }
}
