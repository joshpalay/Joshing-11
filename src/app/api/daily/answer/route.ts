import { and, eq } from 'drizzle-orm';
import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { gradeAnswer, type GradeOutcome } from '@/server/grading';
import { updateDomainDifficultyOnAnswer } from '@/server/adaptive-difficulty';
import { getSession } from '@/server/auth/session';
import {
  dailyQueues,
  db,
  generatedQuestions,
  questions,
} from '@/server/db';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { awardAuthorCredit, isAuthorCreditEligible } from '@/server/mastery/author-credit';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { promoteDeclaredToDemonstrated } from '@/server/knowledge/open-domain';
import { persistGeneratedQuestion } from '@/server/questions/persist-generated-question';
import { type QueueSlot } from '@/server/daily/types';
import { asQueueSlots } from '@/server/daily/catchup';
import { resolveDailyBasePoints } from '@/server/daily/types';
import { resolveEffectiveDifficulty } from '@/server/daily/empirical-difficulty';
import { isGenericCanonicalAnswer, normalizeCanonicalAnswerLabel } from '@/server/answers/canonical-answer';
import { suggestAnswer } from '@/lib/llm';
import { computeAnswerState } from '@/server/answer-state';
import { readPriorAnswersForQuestion } from '@/server/answer-history';
import { RECOVERY_STATE_WEIGHT } from '@/server/mastery/constants';
import { selectInsideJokeForViewer } from '@/server/questions/inside-joke';

export const dynamic = 'force-dynamic';

type DailyAnswerErrorCode =
  | 'unauthorized'
  | 'validation'
  | 'not_found'
  | 'invalid_state'
  | 'question_not_found'
  | 'forbidden'
  | 'grader_unavailable'
  | 'slot_changed'
  | 'unexpected';

function dailyAnswerErrorResponse(status: number, error: DailyAnswerErrorCode, message: string) {
  return NextResponse.json({ error, message }, { status });
}

// The slot the client is answering no longer holds the question it displayed —
// the stored queue was mutated (e.g. a +2 bonus inserted, slots re-indexed)
// after the client snapshotted it, so this slot_index now resolves to a
// different question. Grading would score the typed answer against the wrong
// question (the "answered Austerlitz, marked wrong against Omaha Beach" bug).
// Refuse to grade and hand back the fresh slots so the client can reconcile and
// re-display the real current question without recording a bogus miss.
function slotChangedResponse(slots: QueueSlot[]) {
  return NextResponse.json(
    {
      error: 'slot_changed' satisfies DailyAnswerErrorCode,
      message: 'This question just refreshed — give it another look and answer again.',
      slots,
    },
    { status: 409 },
  );
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

const bodySchema = z.object({
  queue_id: z.string().min(1),
  slot_index: z.number().int(),
  // The question id (generated_question_id ?? question_id) the client believes
  // occupies this slot. Optional for backward compatibility, but when present
  // the server verifies the slot still resolves to it before grading, so a
  // client answering a stale slot_index can't be scored against a different
  // question. See slotChangedResponse.
  expected_question_id: z.string().optional().catch(undefined),
  // gave_up / submitted_answer / answer are permissive: a malformed type is
  // coerced away (matching the prior hand-rolled parser) rather than 400-ing.
  gave_up: z.boolean().optional().catch(undefined),
  submitted_answer: z.string().optional().catch(undefined),
  answer: z.string().optional().catch(undefined),
});

function parseBody(value: unknown): {
  queueId: string;
  slotIndex: number;
  submittedAnswer: string;
  gaveUp: boolean;
  expectedQuestionId: string | null;
} | null {
  const parsed = bodySchema.safeParse(value);
  if (!parsed.success) return null;
  const { queue_id, slot_index, expected_question_id, gave_up, submitted_answer, answer } = parsed.data;
  const gaveUp = gave_up === true;
  const submittedAnswer = (
    typeof submitted_answer === 'string'
      ? submitted_answer
      : typeof answer === 'string'
        ? answer
        : ''
  ).trim();
  if (!gaveUp && !submittedAnswer) return null;
  return {
    queueId: queue_id,
    slotIndex: slot_index,
    submittedAnswer,
    gaveUp,
    expectedQuestionId: expected_question_id ?? null,
  };
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
    if (!slot.generated_question_id && !slot.question_id) {
      return dailyAnswerErrorResponse(400, 'invalid_state', 'That Daily Five slot is not ready yet.');
    }

    // Identity guard: the client displays slot.question_text but only submits
    // slot_index, and grading below resolves the question from the slot's FK. If
    // the queue was re-indexed after the client snapshotted it (a +2 bonus
    // insert re-sorts slots by slot_index), this slot_index can now hold a
    // different question than the one the player saw. Verify the slot still
    // resolves to the question id the client expected; on mismatch, refuse to
    // grade and return the fresh slots so the client re-displays the real
    // question rather than scoring the answer against the wrong one.
    const slotQuestionId = slot.generated_question_id ?? slot.question_id ?? null;
    if (parsed.expectedQuestionId && slotQuestionId && parsed.expectedQuestionId !== slotQuestionId) {
      return slotChangedResponse(slots);
    }

    // The Daily 5 mixes two slot shapes — bot-generated questions live in
    // `generatedQuestions`, while vetted user-authored questions live in the
    // canonical `questions` table and are picked into a `source: 'friend'`
    // slot. Normalise both into a single shape so the rest of the route
    // (grading, mastery, propagation) doesn't care which pool we're in.
    type DailyAnswerQuestion = {
      generatedId: string | null;
      canonicalId: string | null;
      questionText: string;
      answer: string;
      explainer: string | null;
      canonicalSubcategory: string;
      broadCategory: string | null;
      basePoints: number;
      acceptedAlternatives: string[];
    };

    let question: DailyAnswerQuestion;
    if (slot.generated_question_id) {
      const [row] = await db
        .select()
        .from(generatedQuestions)
        .where(and(
          eq(generatedQuestions.id, slot.generated_question_id),
          eq(generatedQuestions.userId, session.userId),
        ))
        .limit(1);
      if (!row) {
        return dailyAnswerErrorResponse(404, 'question_not_found', 'We could not find that Daily Five question.');
      }
      // D11 (B4 Phase 5): once a bank question has real play history, its measured
      // correct rate overrides the model's difficulty_estimate for scoring — the
      // pool teaches the floor what is actually easy. Falls back to the stored
      // basePoints when there isn't enough play yet.
      const effective = resolveEffectiveDifficulty({
        estimate: row.difficultyEstimate,
        empiricalRate: row.empiricalCorrectRate,
        nAnswered: row.nAnswered,
      });
      const basePoints =
        effective.source === 'empirical'
          ? resolveDailyBasePoints(effective.difficulty)
          : Math.round(row.basePoints);
      question = {
        generatedId: row.id,
        canonicalId: null,
        questionText: row.questionText,
        answer: await resolveCanonicalAnswer(row),
        explainer: row.explainer,
        canonicalSubcategory: row.canonicalSubcategory,
        broadCategory: row.broadCategory,
        basePoints,
        // acceptable_variants (B4 Phase 4): right-but-rephrased answers grade correct.
        acceptedAlternatives: row.acceptableVariants ?? [],
      };
    } else {
      const [row] = await db
        .select()
        .from(questions)
        .where(eq(questions.id, slot.question_id!))
        .limit(1);
      if (!row || row.deletedAt) {
        return dailyAnswerErrorResponse(404, 'question_not_found', 'We could not find that Daily Five question.');
      }
      const explainer = row.explainerFull
        ?? row.explainerBrief
        ?? row.factualExplanation
        ?? null;
      const difficulty = row.calibratedDifficulty ?? row.llmDifficulty ?? row.difficultyEstimate ?? null;
      question = {
        generatedId: null,
        canonicalId: row.id,
        questionText: row.questionText,
        answer: row.answerText,
        explainer,
        canonicalSubcategory: row.canonicalSubcategory ?? slot.domain,
        broadCategory: row.broadCategory,
        basePoints: resolveDailyBasePoints(difficulty),
        acceptedAlternatives: row.acceptedAlternatives ?? [],
      };
    }

    const canonicalAnswer = question.answer;

    // Give-up is a deliberate, real wrong — a genuine scored verdict, not an infra
    // failure — so it's constructed as a scored outcome and never held for retry.
    const grade: GradeOutcome = parsed.gaveUp
      ? { status: 'scored', result: 'wrong', consolation: null, confidence: 1, gradedVia: 'exact' }
      : await gradeAnswer(
          parsed.submittedAnswer,
          canonicalAnswer,
          question.acceptedAlternatives,
          question.questionText,
          'factual',
        );
    // The LLM grader was unreachable (timeout, parse error, no client), so there is
    // no verdict at all — the outcome is `unscored`, never a 'wrong'. Scoring the
    // player wrong for an Anthropic outage is the most off-brand failure mode in a
    // product whose thesis is "wrong answers are connection events, not penalties."
    // Instead of persisting anything, hold the answer in a non-scored retry state:
    // leave the slot untouched (unanswered) and return a transparent, retryable
    // error so the player can simply resubmit. Give-ups are scored above, so they
    // are never held here.
    if (grade.status === 'unscored') {
      console.warn('[daily/answer] grader unavailable; holding answer for retry', {
        queueId: parsed.queueId,
        slotIndex: parsed.slotIndex,
        userId: session.userId,
      });
      return dailyAnswerErrorResponse(
        503,
        'grader_unavailable',
        "Our answer-checker is taking a quick breather. Your answer wasn't scored — give it another go in a moment.",
      );
    }
    const isCorrect = grade.result === 'correct';
    const answerState = isCorrect ? 'correct' : 'incorrect';

    // For bot slots: promote the generated question to a canonical row
    // BEFORE writing the mastery event so cross-surface dedup can key on
    // Question.id (F2.1). For friend slots: the canonical row already
    // exists, so skip the promotion and read author metadata directly.
    // If persistence fails the route still records the answer in the
    // queue and the user-visible result is unaffected; only mastery /
    // friend-feed propagation are skipped for this attempt.
    let canonicalQuestionId: string | null = question.canonicalId;
    let persistedCreatorId: string | null = null;
    let persistedDomainForCreator: string | null = null;
    let persistedInsideJoke: string | null = null;

    if (question.generatedId) {
      let persistAttempt = 0;
      while (persistAttempt < 2 && canonicalQuestionId === null) {
        persistAttempt += 1;
        try {
          const persisted = await persistGeneratedQuestion(question.generatedId, slot.domain);
          canonicalQuestionId = persisted.questionId;
          const [persistedQuestion] = await db
            .select({ creatorId: questions.creatorId, domain: questions.canonicalSubcategory, broadCategory: questions.broadCategory, category: questions.category, insideJoke: questions.insideJoke })
            .from(questions)
            .where(eq(questions.id, persisted.questionId))
            .limit(1);
          persistedCreatorId = persistedQuestion?.creatorId ?? null;
          persistedDomainForCreator =
            persistedQuestion?.domain || persistedQuestion?.broadCategory || persistedQuestion?.category || null;
          persistedInsideJoke = persistedQuestion?.insideJoke ?? null;
        } catch (error) {
          const finalAttempt = persistAttempt >= 2;
          console.warn(
            finalAttempt
              ? '[daily/answer] persistGeneratedQuestion failed after retry; canonical id will be backfilled later'
              : '[daily/answer] persistGeneratedQuestion failed; retrying once',
            {
              generatedQuestionId: question.generatedId,
              attempt: persistAttempt,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
    } else if (question.canonicalId) {
      const [canonicalRow] = await db
        .select({
          creatorId: questions.creatorId,
          domain: questions.canonicalSubcategory,
          broadCategory: questions.broadCategory,
          category: questions.category,
          insideJoke: questions.insideJoke,
        })
        .from(questions)
        .where(eq(questions.id, question.canonicalId))
        .limit(1);
      persistedCreatorId = canonicalRow?.creatorId ?? null;
      persistedDomainForCreator =
        canonicalRow?.domain || canonicalRow?.broadCategory || canonicalRow?.category || null;
      persistedInsideJoke = canonicalRow?.insideJoke ?? null;
    }

    // Authors can't answer their own questions. The Daily Five candidate
    // selection at src/server/db/queries/daily.ts:612 already filters out
    // viewer-authored questions, but direct POSTs (e.g. against a stale
    // queue slot) would otherwise still be accepted here.
    if (persistedCreatorId && persistedCreatorId === session.userId) {
      return dailyAnswerErrorResponse(403, 'forbidden', 'You can’t answer your own question.');
    }

    // Compute answer_state against masteryEvents history so first_correct
    // vs first_correct_after_wrong vs repeat_correct vs incorrect is
    // determined correctly across surfaces (F2.1). Falls back to the old
    // behaviour (treat as first attempt) only if persistence failed and we
    // have no canonical id to look up history against.
    // priorAnswers (mastery history) and insideJokeForViewer (friendship check)
    // are independent of each other and of the grader output, so fan them out
    // in parallel. The viewer joke isn't consumed until nextSlots is built
    // below; pre-resolving it here removes a serial round-trip.
    const [priorAnswers, insideJokeForViewer] = await Promise.all([
      canonicalQuestionId
        ? readPriorAnswersForQuestion(session.userId, canonicalQuestionId)
        : Promise.resolve<{ result: 'correct' | 'wrong' }[]>([]),
      selectInsideJokeForViewer(persistedInsideJoke, persistedCreatorId, session.userId),
    ]);
    const masteryAnswerState = computeAnswerState(
      isCorrect ? 'correct' : 'wrong',
      priorAnswers,
    );
    const basePoints = question.basePoints;
    // A correct answer in an unfamiliar domain default-adds it to the player's
    // Knowledge base — including bot-generated Daily Five questions, which now
    // match the authored path. The old PRD §8.4.3 gate (bot questions could only
    // deepen existing domains) has been removed in favour of default-add with an
    // easy undo; writeMasteryEvent's ON CONFLICT DO UPDATE opens the domain the
    // same way the authored flow does (src/app/api/questions/[id]/answer).
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
        submitted_answer: parsed.gaveUp ? '' : parsed.submittedAnswer,
        awarded_points: pointsAwarded,
        reveal_canonical_answer: canonicalAnswer,
        reveal_explainer: question.explainer ?? undefined,
        reveal_inside_joke: insideJokeForViewer?.text ?? null,
        reveal_inside_joke_kind: insideJokeForViewer?.kind ?? null,
        reveal_quip: grade.consolation,
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
        questionId: question.generatedId ?? question.canonicalId ?? canonicalQuestionId ?? `${queue.id}:${parsed.slotIndex}`,
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

    // Adaptive-difficulty bookkeeping is not consumed by the response; let it
    // run after we've already returned. The function swallows its own errors
    // via the .catch below, so an unhandled rejection cannot escape.
    void updateDomainDifficultyOnAnswer(
      session.userId,
      question.canonicalSubcategory,
      isCorrect,
    ).catch((err) => {
      console.warn('[daily/answer] updateDomainDifficultyOnAnswer failed', err);
    });

    if (canonicalQuestionId && !parsed.gaveUp) {
      const propagationKey = question.generatedId ?? question.canonicalId ?? canonicalQuestionId;
      try {
        const creditContext = {
          isCorrect,
          creatorId: persistedCreatorId,
          answererUserId: session.userId,
          domain: persistedDomainForCreator,
        };
        if (isAuthorCreditEligible(creditContext)) {
          void promoteDeclaredToDemonstrated({
            userId: creditContext.creatorId,
            domain: creditContext.domain,
            triggeringFriendId: session.userId,
            questionId: canonicalQuestionId,
          });

          // Author credit (PRD §8.32): off the user's hot path — three queries
          // the answerer never sees in their response.
          void awardAuthorCredit({
            creatorUserId: creditContext.creatorId,
            answererUserId: session.userId,
            questionId: canonicalQuestionId,
            domain: creditContext.domain,
            sourceId: `daily:${propagationKey}:${session.userId}`,
            scope: 'daily/answer',
          });
        }

        // Fan-out runs after the response is sent: the user-visible reveal does
        // not depend on this work, and the propagation function swallows its
        // own errors (see create-feed-items-for-answer.ts). after() keeps the
        // function alive past the response so Vercel doesn't freeze the work
        // mid-flight — bare `void` would drop the promise on production lambdas.
        after(() => createFeedItemsForFriendsFromAnswer(
          session.userId,
          canonicalQuestionId,
          isCorrect ? 'correct' : 'incorrect',
          `daily:${propagationKey}:${session.userId}`,
        ));
      } catch (error) {
        console.warn('[daily/answer] feed propagation failed', {
          generatedQuestionId: question.generatedId,
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
      insideJoke: insideJokeForViewer?.text ?? null,
      insideJokeKind: insideJokeForViewer?.kind ?? null,
    });
  } catch (error) {
    console.error('[daily/answer] unexpected failure', error);
    return dailyAnswerErrorResponse(500, 'unexpected', 'Could not record that answer.');
  }
}
