import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { gradeAnswer, selectQuip } from '@/server/grading';
import { updateDomainDifficultyOnAnswer } from '@/server/adaptive-difficulty';
import { getSession } from '@/server/auth/session';
import {
  dailyQueues,
  db,
  generatedQuestions,
  playerMastery,
  questions,
} from '@/server/db';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { awardAuthorCredit } from '@/server/mastery/author-credit';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { promoteDeclaredToDemonstrated } from '@/server/knowledge/open-domain';
import { persistGeneratedQuestion } from '@/server/questions/persist-generated-question';
import { type QueueSlot } from '@/server/daily/types';
import { asQueueSlots } from '@/server/daily/catchup';
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

function parseBody(value: unknown): { queueId: string; slotIndex: number; submittedAnswer: string; gaveUp: boolean } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const queueId = typeof record.queue_id === 'string' ? record.queue_id : null;
  const slotIndex = typeof record.slot_index === 'number' && Number.isInteger(record.slot_index)
    ? record.slot_index
    : null;
  const gaveUp = record.gave_up === true;
  const submittedAnswer = typeof record.submitted_answer === 'string'
    ? record.submitted_answer.trim()
    : typeof record.answer === 'string'
      ? record.answer.trim()
      : '';

  if (!queueId || slotIndex === null) return null;
  if (!gaveUp && !submittedAnswer) return null;
  return { queueId, slotIndex, submittedAnswer, gaveUp };
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

    const grade = parsed.gaveUp
      ? { result: 'wrong' as const, consolation: null }
      : await gradeAnswer(
          parsed.submittedAnswer,
          canonicalAnswer,
          [],
          question.questionText,
          'factual',
        );
    const isCorrect = grade.result === 'correct';
    const answerState = isCorrect ? 'correct' : 'incorrect';
    const quip = parsed.gaveUp ? null : selectQuip({ isCorrect, surface: 'daily', friendResult: null });

    // Promote the bot question to a canonical row BEFORE writing the mastery
    // event so cross-surface dedup can key on the canonical Question.id
    // (F2.1). If persistence fails the route still records the answer in the
    // queue and the user-visible result is unaffected; only mastery /
    // friend-feed propagation are skipped for this attempt.
    let canonicalQuestionId: string | null = null;
    let persistedCreatorId: string | null = null;
    let persistedDomainForCreator: string | null = null;
    let persistAttempt = 0;
    while (persistAttempt < 2 && canonicalQuestionId === null) {
      persistAttempt += 1;
      try {
        const persisted = await persistGeneratedQuestion(question.id, slot.domain);
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
            ? '[daily/answer] persistGeneratedQuestion failed after retry; canonical id will be backfilled later'
            : '[daily/answer] persistGeneratedQuestion failed; retrying once',
          {
            generatedQuestionId: question.id,
            attempt: persistAttempt,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
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
    const uncheckedPointsAwarded =
      masteryAnswerState === 'first_correct'
        ? basePoints
        : masteryAnswerState === 'first_correct_after_wrong'
          ? Math.round(basePoints * RECOVERY_STATE_WEIGHT)
          : 0;

    // PRD §8.4.3 — LLM-generated Daily Five questions can only deepen mastery
    // in existing Knowledge base domains; they cannot open new ones. For a
    // bot-source question whose domain isn't in the player's playerMastery,
    // skip the mastery event and award 0 points rather than letting
    // ON CONFLICT DO UPDATE silently insert a ghost domain row.
    let skipMasteryForUnknownDomain = false;
    if (slot.source === 'bot' && uncheckedPointsAwarded > 0) {
      const [existingDomain] = await db
        .select({ canonicalSubcategory: playerMastery.canonicalSubcategory })
        .from(playerMastery)
        .where(and(
          eq(playerMastery.userId, session.userId),
          eq(playerMastery.canonicalSubcategory, question.canonicalSubcategory),
        ))
        .limit(1);
      if (!existingDomain) {
        skipMasteryForUnknownDomain = true;
        console.warn('[daily/answer] bot question domain not in player KB; skipping mastery write', {
          userId: session.userId,
          domain: question.canonicalSubcategory,
          generatedQuestionId: question.id,
        });
      }
    }
    const pointsAwarded = skipMasteryForUnknownDomain ? 0 : uncheckedPointsAwarded;

    const nextSlots = slots.map((item) => {
      if (item.slot_index !== parsed.slotIndex) return item;
      return {
        ...item,
        answered: true,
        answer_state: answerState,
        submitted_answer: parsed.gaveUp ? '' : parsed.submittedAnswer,
        awarded_points: pointsAwarded,
        reveal_canonical_answer: canonicalAnswer,
        reveal_explainer: question.explainer,
        reveal_quip: grade.consolation,
        quip,
      } satisfies QueueSlot;
    });

    await db
      .update(dailyQueues)
      .set({ slots: nextSlots })
      .where(eq(dailyQueues.id, queue.id));

    let masteryDelta = null;
    if (!skipMasteryForUnknownDomain) {
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
    }

    await updateDomainDifficultyOnAnswer(
      session.userId,
      question.canonicalSubcategory,
      isCorrect,
    ).catch((err) => {
      console.warn('[daily/answer] updateDomainDifficultyOnAnswer failed', err);
    });

    if (canonicalQuestionId && !parsed.gaveUp) {
      try {
        if (isCorrect && persistedCreatorId && persistedCreatorId !== session.userId && persistedDomainForCreator) {
          void promoteDeclaredToDemonstrated({
            userId: persistedCreatorId,
            domain: persistedDomainForCreator,
            triggeringFriendId: session.userId,
            questionId: canonicalQuestionId,
          });

          // Author credit (PRD §8.32): off the user's hot path — three queries
          // the answerer never sees in their response.
          void awardAuthorCredit({
            creatorUserId: persistedCreatorId,
            answererUserId: session.userId,
            questionId: canonicalQuestionId,
            domain: persistedDomainForCreator,
            sourceId: `daily:${question.id}:${session.userId}`,
            scope: 'daily/answer',
          });
        }

        // Fan-out runs after the response is sent: the user-visible reveal does
        // not depend on this work, and the propagation function swallows its
        // own errors (see create-feed-items-for-answer.ts).
        void createFeedItemsForFriendsFromAnswer(
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
      gaveUp: parsed.gaveUp,
      explanation: question.explainer,
      pointsAwarded,
      answerState,
      breadcrumb: null,
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
