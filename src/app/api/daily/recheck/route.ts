import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { updateDomainDifficultyOnAnswer } from '@/server/adaptive-difficulty';
import { getSession } from '@/server/auth/session';
import { dailyQueues, db, generatedQuestions, gradeDisputes } from '@/server/db';
import { type QueueSlot } from '@/server/daily/types';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { isGenericCanonicalAnswer, normalizeCanonicalAnswerLabel } from '@/server/answers/canonical-answer';
import { suggestAnswer } from '@/lib/llm';
import { recheckAnswerWithLLM } from '@/server/llm/recheck';
import { persistGeneratedQuestion } from '@/server/questions/persist-generated-question';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';

export const dynamic = 'force-dynamic';

type RecheckErrorCode = 'unauthorized' | 'validation' | 'not_found' | 'invalid_state' | 'question_not_found' | 'unexpected';

function errorResponse(status: number, error: RecheckErrorCode, message: string) {
  return NextResponse.json({ error, message }, { status });
}

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

function parseBody(value: unknown): { queueId: string; slotIndex: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const queueId = typeof record.queue_id === 'string' ? record.queue_id : null;
  const slotIndex = typeof record.slot_index === 'number' && Number.isInteger(record.slot_index)
    ? record.slot_index
    : null;
  if (!queueId || slotIndex === null) return null;
  return { queueId, slotIndex };
}

async function resolveCanonicalAnswer(question: typeof generatedQuestions.$inferSelect): Promise<string> {
  const currentAnswer = normalizeCanonicalAnswerLabel(question.answer);
  if (!isGenericCanonicalAnswer(currentAnswer)) return currentAnswer;

  const suggestion = await suggestAnswer(question.questionText).catch(() => null);
  const repairedAnswer = suggestion?.suggested_answer
    ? normalizeCanonicalAnswerLabel(suggestion.suggested_answer)
    : null;

  if (!repairedAnswer || isGenericCanonicalAnswer(repairedAnswer)) return currentAnswer;

  await db
    .update(generatedQuestions)
    .set({ answer: repairedAnswer })
    .where(eq(generatedQuestions.id, question.id))
    .catch((error) => {
      console.warn('[daily/recheck] failed to persist repaired canonical answer', {
        generatedQuestionId: question.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return repairedAnswer;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return errorResponse(401, 'unauthorized', 'Please sign in to request a recheck.');

    const parsed = parseBody(await request.json().catch(() => null));
    if (!parsed) return errorResponse(400, 'validation', 'queue_id and slot_index are required');

    const [queue] = await db
      .select()
      .from(dailyQueues)
      .where(and(eq(dailyQueues.id, parsed.queueId), eq(dailyQueues.userId, session.userId)))
      .limit(1);

    if (!queue) return errorResponse(404, 'not_found', 'We could not find that Daily Five queue.');

    const slots = asQueueSlots(queue.slots);
    const slot = slots.find((item) => item.slot_index === parsed.slotIndex);
    if (!slot) return errorResponse(400, 'validation', 'slot_index out of range');
    if (!slot.answered || !slot.submitted_answer) {
      return errorResponse(400, 'invalid_state', 'Answer the question before requesting a recheck.');
    }
    if (slot.answer_state === 'correct') {
      return errorResponse(400, 'invalid_state', 'That answer is already marked correct.');
    }
    if (slot.recheck_status) {
      return errorResponse(400, 'invalid_state', 'That answer has already been rechecked.');
    }
    if (!slot.generated_question_id) {
      return errorResponse(400, 'invalid_state', 'Only Daily generated questions can be rechecked here.');
    }

    const [question] = await db
      .select()
      .from(generatedQuestions)
      .where(and(
        eq(generatedQuestions.id, slot.generated_question_id),
        eq(generatedQuestions.userId, session.userId),
      ))
      .limit(1);

    if (!question) return errorResponse(404, 'question_not_found', 'We could not find that Daily Five question.');

    const canonicalAnswer = slot.reveal_canonical_answer ?? await resolveCanonicalAnswer(question);
    const review = await recheckAnswerWithLLM({
      questionText: question.questionText,
      canonicalAnswer,
      submittedAnswer: slot.submitted_answer,
      questionType: 'factual',
      acceptedAlternatives: [],
    });

    const accepted = review.decision === 'accept';
    const pointsAwarded = accepted ? Math.round(question.basePoints) : 0;
    const recheckStatus = accepted ? 'accepted' : review.decision === 'reject' ? 'rejected' : 'needs_human';
    const disputeStatus = accepted ? 'alternative_added' : review.decision === 'reject' ? 'dismissed' : 'pending';
    const answerId = `daily:${queue.id}:${parsed.slotIndex}:${session.userId}`;

    const nextSlots = slots.map((item) => {
      if (item.slot_index !== parsed.slotIndex) return item;
      return {
        ...item,
        answer_state: accepted ? 'correct' : 'incorrect',
        awarded_points: accepted ? pointsAwarded : item.awarded_points ?? 0,
        reveal_canonical_answer: canonicalAnswer,
        recheck_status: recheckStatus,
        recheck_reason: review.reason,
      } satisfies QueueSlot;
    });

    await db.transaction(async (tx) => {
      await tx
        .update(dailyQueues)
        .set({ slots: nextSlots })
        .where(eq(dailyQueues.id, queue.id));

      await tx
        .insert(gradeDisputes)
        .values({
          answerId,
          questionId: question.id,
          creatorId: session.userId,
          submittedAnswer: slot.submitted_answer ?? '',
          canonicalAnswer,
          questionText: question.questionText,
          surface: 'daily',
          reviewDecision: review.decision,
          reviewReason: review.reason,
          acceptedAlternative: review.acceptedAlternative,
          status: disputeStatus,
          reviewedAt: review.decision === 'needs_human' ? null : new Date(),
        })
        .onConflictDoUpdate({
          target: gradeDisputes.answerId,
          set: {
            canonicalAnswer,
            questionText: question.questionText,
            surface: 'daily',
            reviewDecision: review.decision,
            reviewReason: review.reason,
            acceptedAlternative: review.acceptedAlternative,
            status: disputeStatus,
            reviewedAt: review.decision === 'needs_human' ? null : new Date(),
          },
        });
    });

    let masteryDelta = null;
    if (accepted) {
      // Promote the bot question to a canonical row BEFORE writing the
      // mastery event so the question_id column links to questions.id and
      // friend-feed propagation has a canonical id to key on. Without this
      // the mastery event records question_id=NULL and friend feeds never
      // see the answer — same failure mode that the daily/answer route had.
      let canonicalQuestionId: string | null = null;
      let persistAttempt = 0;
      while (persistAttempt < 2 && canonicalQuestionId === null) {
        persistAttempt += 1;
        try {
          const persisted = await persistGeneratedQuestion(question.id, question.canonicalSubcategory);
          canonicalQuestionId = persisted.questionId;
        } catch (error) {
          const finalAttempt = persistAttempt >= 2;
          console.warn(
            finalAttempt
              ? '[daily/recheck] persistGeneratedQuestion failed after retry; canonical id will be backfilled later'
              : '[daily/recheck] persistGeneratedQuestion failed; retrying once',
            {
              generatedQuestionId: question.id,
              attempt: persistAttempt,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }

      masteryDelta = await writeMasteryEvent({
        userId: session.userId,
        questionId: question.id,
        domain: question.canonicalSubcategory,
        answerState: 'first_correct',
        pointsAwarded,
        sourceType: 'daily',
        sourceId: `${queue.id}:${parsed.slotIndex}:recheck`,
        broadCategory: question.broadCategory,
        eventQuestionId: canonicalQuestionId,
        basePoints: question.basePoints,
        weight: 1,
      }).catch((error) => {
        console.warn('[daily/recheck] writeMasteryEvent failed', error);
        return null;
      });

      await updateDomainDifficultyOnAnswer(session.userId, question.canonicalSubcategory, true).catch((error) => {
        console.warn('[daily/recheck] updateDomainDifficultyOnAnswer failed', error);
      });

      if (canonicalQuestionId) {
        try {
          await createFeedItemsForFriendsFromAnswer(
            session.userId,
            canonicalQuestionId,
            'correct',
            `daily:${question.id}:${session.userId}`,
          );
        } catch (error) {
          console.warn('[daily/recheck] feed propagation failed', {
            generatedQuestionId: question.id,
            canonicalQuestionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return NextResponse.json({
      accepted,
      status: recheckStatus,
      reason: review.reason,
      acceptedAlternative: review.acceptedAlternative,
      pointsAwarded,
      correctAnswer: canonicalAnswer,
      masteryDelta,
    });
  } catch (error) {
    console.error('[daily/recheck] unexpected', error);
    return errorResponse(500, 'unexpected', 'Could not recheck that answer.');
  }
}
