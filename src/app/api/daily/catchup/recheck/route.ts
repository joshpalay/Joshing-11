import { and, eq } from 'drizzle-orm';
import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { updateDomainDifficultyOnAnswer } from '@/server/adaptive-difficulty';
import { getSession } from '@/server/auth/session';
import { dailyQueues, db, generatedQuestions, gradeDisputes, questions } from '@/server/db';
import {
  asQueueSlots,
  findQueueSlotBySlotIndex,
  parseCatchupItemId,
  replaceQueueSlot,
} from '@/server/daily/catchup';
import { type QueueSlot } from '@/server/daily/types';
import { isBonusSlot } from '@/server/daily/bonus';
import { recheckAnswerWithLLM } from '@/server/llm/recheck';
import { recordAcceptedAlternative } from '@/server/answers/record-accepted-alternative';
import { persistGeneratedQuestion } from '@/server/questions/persist-generated-question';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { canonicalPointsForAnswer } from '@/lib/game-constants';

export const dynamic = 'force-dynamic';

// Recheck (appeal a wrong grade) for a CATCH-UP attempt on a Daily Five slot.
//
// Why a separate route from /api/daily/recheck: catch-up re-answers a missed or
// wrong slot WITHOUT touching the live verdict — it writes its own
// `catchup_answer_state` / `catchup_submitted_answer` on the slot and leaves
// `answer_state` / `submitted_answer` (the live-round result) untouched. The
// daily recheck route keys off those live fields and bails on a catch-up slot
// (`!slot.answered` → "Answer the question before requesting a recheck"), so a
// catch-up mis-grade had NO appeal path at all. This route operates on the
// `catchup_*` fields and, on accept, flips `catchup_answer_state` to 'correct'
// (the live verdict still stays put), exactly mirroring how the catch-up answer
// route records its outcome.
//
// Scope: daily-surface catch-up only. Feed-surface catch-up does not persist the
// catch-up submission text (handleFeedCatchupAnswer only stamps catchupResolvedAt
// + answerResult), so there is no catch-up answer to recheck — the original feed
// answer is appealable through /api/feed/{feedItemId}/recheck instead.

type RecheckErrorCode = 'unauthorized' | 'validation' | 'not_found' | 'invalid_state' | 'question_not_found' | 'unexpected';

function errorResponse(status: number, error: RecheckErrorCode, message: string) {
  return NextResponse.json({ error, message }, { status });
}

const bodySchema = z.object({
  dailyQueueItemId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return errorResponse(401, 'unauthorized', 'Please sign in to request a recheck.');

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse(400, 'validation', 'dailyQueueItemId is required');

    const dispatch = parseCatchupItemId(parsed.data.dailyQueueItemId);
    if (!dispatch) return errorResponse(400, 'validation', 'dailyQueueItemId is malformed');
    if (dispatch.surface !== 'daily') {
      // Feed-surface catch-up has no persisted catch-up submission to recheck;
      // the original feed answer is appealable via /api/feed/{id}/recheck.
      return errorResponse(400, 'invalid_state', 'This catch-up item is not eligible for recheck here.');
    }

    const [queue] = await db
      .select()
      .from(dailyQueues)
      .where(and(eq(dailyQueues.id, dispatch.queueId), eq(dailyQueues.userId, session.userId)))
      .limit(1);
    if (!queue) return errorResponse(404, 'not_found', 'We could not find that Daily Five queue.');

    const slots = asQueueSlots(queue.slots);
    const slot = findQueueSlotBySlotIndex(slots, dispatch.slotIndex);
    if (!slot) return errorResponse(400, 'validation', 'slot_index out of range');
    if (!slot.catchup_answered_at || !slot.catchup_submitted_answer) {
      return errorResponse(400, 'invalid_state', 'Answer the catch-up question before requesting a recheck.');
    }
    if (slot.catchup_answer_state === 'correct') {
      return errorResponse(400, 'invalid_state', 'That catch-up answer is already marked correct.');
    }
    if (slot.catchup_recheck_status) {
      return errorResponse(400, 'invalid_state', 'That catch-up answer has already been rechecked.');
    }
    if (!slot.generated_question_id && !slot.question_id) {
      return errorResponse(400, 'invalid_state', 'That catch-up slot has no question to recheck.');
    }

    // Resolve the answer key for the reviewer. Bot slots carry their alternatives
    // on the GeneratedQuestion (acceptable_variants); friend/house slots on the
    // canonical Question (accepted_alternatives).
    let acceptedAlternatives: string[] = [];
    let domain = slot.domain;
    let broadCategory: string | null = slot.broad_category ?? null;
    if (slot.generated_question_id) {
      const [row] = await db
        .select({
          acceptableVariants: generatedQuestions.acceptableVariants,
          canonicalSubcategory: generatedQuestions.canonicalSubcategory,
          broadCategory: generatedQuestions.broadCategory,
        })
        .from(generatedQuestions)
        .where(eq(generatedQuestions.id, slot.generated_question_id))
        .limit(1);
      acceptedAlternatives = row?.acceptableVariants ?? [];
      domain = row?.canonicalSubcategory || slot.domain;
      broadCategory = row?.broadCategory ?? broadCategory;
    } else if (slot.question_id) {
      const [row] = await db
        .select({
          acceptedAlternatives: questions.acceptedAlternatives,
          canonicalSubcategory: questions.canonicalSubcategory,
          broadCategory: questions.broadCategory,
          deletedAt: questions.deletedAt,
        })
        .from(questions)
        .where(eq(questions.id, slot.question_id))
        .limit(1);
      if (!row || row.deletedAt) {
        return errorResponse(404, 'question_not_found', 'We could not find that catch-up question.');
      }
      acceptedAlternatives = row.acceptedAlternatives ?? [];
      domain = row.canonicalSubcategory || slot.domain;
      broadCategory = row.broadCategory ?? broadCategory;
    }

    const canonicalAnswer = slot.reveal_canonical_answer ?? '';
    const review = await recheckAnswerWithLLM({
      questionText: slot.question_text,
      canonicalAnswer,
      submittedAnswer: slot.catchup_submitted_answer,
      // Daily-generated slots are factual by construction; friend slots are also
      // graded factually on the catch-up path (parity with the catch-up answer
      // route, which passes the stored type — generated rows have none).
      questionType: 'factual',
      acceptedAlternatives,
    });

    const accepted = review.decision === 'accept';
    // A disputed answer key reads as "taking another look", not a rejection.
    const recheckStatus = accepted ? 'accepted' : review.decision === 'reject' ? 'rejected' : 'needs_human';
    const disputeStatus = accepted ? 'alternative_added' : 'pending';
    const reviewedAt = accepted ? new Date() : null;

    // Catch-up scoring uses the shared canonical scorer with the catch-up surface
    // weight (D-RECOVERY-SCORING-UNIFY-01), same as the catch-up answer route.
    const pointsAwarded = accepted
      ? canonicalPointsForAnswer({
          difficulty: slot.difficulty_estimate ?? null,
          answerState: 'first_correct',
          catchUp: true,
        })
      : 0;

    // Persist a bot slot's GeneratedQuestion to a canonical Question first: the
    // dispute row's questionId must reference questions.id, and the answer-key
    // write-back + mastery event key on the canonical id. Mirrors daily/recheck.
    let canonicalQuestionId: string | null = slot.question_id ?? null;
    const generatedQuestionId = slot.generated_question_id ?? null;
    if (generatedQuestionId && !canonicalQuestionId) {
      let persistAttempt = 0;
      while (persistAttempt < 2 && canonicalQuestionId === null) {
        persistAttempt += 1;
        try {
          const persisted = await persistGeneratedQuestion(generatedQuestionId, domain);
          canonicalQuestionId = persisted.questionId;
        } catch (error) {
          const finalAttempt = persistAttempt >= 2;
          console.warn(
            finalAttempt
              ? '[daily/catchup/recheck] persistGeneratedQuestion failed after retry; canonical id will be backfilled later'
              : '[daily/catchup/recheck] persistGeneratedQuestion failed; retrying once',
            {
              generatedQuestionId,
              attempt: persistAttempt,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
    }

    const nextSlots = replaceQueueSlot(slots, dispatch.slotIndex, (item) => ({
      ...item,
      // Record the appeal outcome in the catch-up fields ONLY — the live-round
      // verdict (answer_state/submitted_answer/awarded_points) stays untouched,
      // same invariant the catch-up answer route preserves.
      catchup_answer_state: accepted ? 'correct' : 'incorrect',
      catchup_awarded_points: accepted ? pointsAwarded : item.catchup_awarded_points ?? 0,
      catchup_recheck_status: recheckStatus,
      catchup_recheck_reason: review.reason,
    } satisfies QueueSlot));

    await db.transaction(async (tx) => {
      await tx.update(dailyQueues).set({ slots: nextSlots }).where(eq(dailyQueues.id, queue.id));

      // Fall back to the generated id so the dispute still records a traceable
      // anchor if canonical persistence failed for a bot slot.
      const disputeQuestionId = canonicalQuestionId ?? generatedQuestionId ?? slot.question_id!;
      await tx
        .insert(gradeDisputes)
        .values({
          answerId: `catchup-recheck:${queue.id}:${dispatch.slotIndex}:${session.userId}`,
          questionId: disputeQuestionId,
          creatorId: session.userId,
          submittedAnswer: slot.catchup_submitted_answer ?? '',
          canonicalAnswer,
          questionText: slot.question_text,
          surface: 'daily_catchup',
          reviewDecision: review.decision,
          reviewReason: review.reason,
          acceptedAlternative: review.acceptedAlternative,
          status: disputeStatus,
          reviewedAt,
        })
        .onConflictDoUpdate({
          target: gradeDisputes.answerId,
          set: {
            canonicalAnswer,
            questionText: slot.question_text,
            surface: 'daily_catchup',
            reviewDecision: review.decision,
            reviewReason: review.reason,
            acceptedAlternative: review.acceptedAlternative,
            status: disputeStatus,
            reviewedAt,
          },
        });
    });

    let masteryDelta = null;
    if (accepted) {
      // Fix 2: fold the accepted alternative into the answer key (canonical row +
      // originating generated row) so the same answer is never wronged again.
      await recordAcceptedAlternative({
        canonicalQuestionId,
        generatedQuestionId,
        alternative: review.acceptedAlternative,
      });

      masteryDelta = await writeMasteryEvent({
        userId: session.userId,
        questionId: generatedQuestionId ?? canonicalQuestionId ?? `${queue.id}:${dispatch.slotIndex}`,
        domain,
        answerState: 'first_correct',
        pointsAwarded,
        sourceType: 'catchup',
        isBonus: isBonusSlot(slot),
        sourceId: `${queue.id}:${dispatch.slotIndex}:recheck`,
        broadCategory,
        eventQuestionId: canonicalQuestionId,
        basePoints: pointsAwarded,
        weight: 1,
      }).catch((error) => {
        console.warn('[daily/catchup/recheck] writeMasteryEvent failed', error);
        return null;
      });

      await updateDomainDifficultyOnAnswer(session.userId, domain, true).catch((error) => {
        console.warn('[daily/catchup/recheck] updateDomainDifficultyOnAnswer failed', error);
      });

      if (canonicalQuestionId) {
        try {
          const propagationKey = generatedQuestionId ?? canonicalQuestionId;
          after(() => createFeedItemsForFriendsFromAnswer(
            session.userId,
            canonicalQuestionId,
            'correct',
            `catchup:${propagationKey}:${session.userId}`,
          ));
        } catch (error) {
          console.warn('[daily/catchup/recheck] feed propagation failed', {
            generatedQuestionId,
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
    console.error('[daily/catchup/recheck] unexpected', error);
    return errorResponse(500, 'unexpected', 'Could not recheck that answer.');
  }
}
