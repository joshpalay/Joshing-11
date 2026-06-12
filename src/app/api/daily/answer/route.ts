import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { gradeAnswer, type GradableQuestionType, type GradeOutcome } from '@/server/grading';
import { getSession } from '@/server/auth/session';
import {
  dailyQueues,
  db,
  generatedQuestions,
  questions,
} from '@/server/db';
import { deriveAnswerOutcome, recordAnswerSideEffects } from '@/server/answers/answer-pipeline';
import { persistGeneratedQuestion } from '@/server/questions/persist-generated-question';
import { type QueueSlot } from '@/server/daily/types';
import { asQueueSlots } from '@/server/daily/catchup';
import { resolveDailyBasePoints } from '@/server/daily/types';
import { resolveEffectiveDifficulty } from '@/server/daily/empirical-difficulty';
import { isGenericCanonicalAnswer, normalizeCanonicalAnswerLabel } from '@/server/answers/canonical-answer';
import { suggestAnswer } from '@/lib/llm';
import { RECOVERY_STATE_WEIGHT } from '@/server/mastery/constants';
import { selectInsideJokeForViewer } from '@/server/questions/inside-joke';

export const dynamic = 'force-dynamic';

// Cold-start tag (B-GRADE-COLDSTART-01): true only for the first request a fresh
// serverless instance handles — the one that waited behind register()'s boot DB
// work. Flipped to false after the first request so warm requests are tagged
// accurately. Lets the timing log separate cold vs warm grade latency.
let isFirstRequestOnInstance = true;

// Coarse per-request step timing for the grading critical path
// (B-GRADE-FASTPATH-01). Absolute Date.now() stamps; deltas are computed
// defensively at the end so an early error-return still logs whatever stages it
// reached. Telemetry only — logging never alters the response.
type StepMarks = {
  start: number;
  cold: boolean;
  session?: number;
  load?: number;
  grade?: number;
  persist?: number;
  mastery?: number;
};

function logStepTimings(marks: StepMarks) {
  try {
    const delta = (to: number | undefined, from: number | undefined) =>
      to != null && from != null ? to - from : undefined;
    console.info('[daily/answer timings]', {
      cold: marks.cold,
      session_ms: delta(marks.session, marks.start),
      load_ms: delta(marks.load, marks.session),
      grade_ms: delta(marks.grade, marks.load),
      persist_ms: delta(marks.persist, marks.grade),
      mastery_ms: delta(marks.mastery, marks.persist),
      total_ms: Date.now() - marks.start,
    });
  } catch {
    // telemetry only — swallow
  }
}

type DailyAnswerErrorCode =
  | 'unauthorized'
  | 'validation'
  | 'not_found'
  | 'invalid_state'
  | 'question_not_found'
  | 'forbidden'
  | 'grader_unavailable'
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

const bodySchema = z.object({
  queue_id: z.string().min(1),
  slot_index: z.number().int(),
  // gave_up / submitted_answer / answer are permissive: a malformed type is
  // coerced away (matching the prior hand-rolled parser) rather than 400-ing.
  gave_up: z.boolean().optional().catch(undefined),
  submitted_answer: z.string().optional().catch(undefined),
  answer: z.string().optional().catch(undefined),
});

function parseBody(value: unknown): { queueId: string; slotIndex: number; submittedAnswer: string; gaveUp: boolean } | null {
  const parsed = bodySchema.safeParse(value);
  if (!parsed.success) return null;
  const { queue_id, slot_index, gave_up, submitted_answer, answer } = parsed.data;
  const gaveUp = gave_up === true;
  const submittedAnswer = (
    typeof submitted_answer === 'string'
      ? submitted_answer
      : typeof answer === 'string'
        ? answer
        : ''
  ).trim();
  if (!gaveUp && !submittedAnswer) return null;
  return { queueId: queue_id, slotIndex: slot_index, submittedAnswer, gaveUp };
}

export async function POST(request: NextRequest) {
  const marks: StepMarks = { start: Date.now(), cold: isFirstRequestOnInstance };
  isFirstRequestOnInstance = false;
  try {
    const session = await getSession();
    marks.session = Date.now();
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
      questionType: GradableQuestionType;
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
        // generatedQuestions has no question_type column — bot questions are
        // factual by construction (the D-5 retrieval-grounded pipeline).
        questionType: 'factual',
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
        // Friend slots are canonical questions and carry the author's stored
        // type — a 'personal' question must reach the grader's leniency branch.
        questionType: row.questionType,
      };
    }

    const canonicalAnswer = question.answer;
    marks.load = Date.now();

    // Give-up is a deliberate, real wrong — a genuine scored verdict, not an infra
    // failure — so it's constructed as a scored outcome and never held for retry.
    const grade: GradeOutcome = parsed.gaveUp
      ? { status: 'scored', result: 'wrong', consolation: null, confidence: 1, gradedVia: 'exact' }
      : await gradeAnswer(
          parsed.submittedAnswer,
          canonicalAnswer,
          question.acceptedAlternatives,
          question.questionText,
          question.questionType,
        );
    marks.grade = Date.now();
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
    marks.persist = Date.now();

    // Authors can't answer their own questions. The Daily Five candidate
    // selection at src/server/db/queries/daily.ts:612 already filters out
    // viewer-authored questions, but direct POSTs (e.g. against a stale
    // queue slot) would otherwise still be accepted here.
    if (persistedCreatorId && persistedCreatorId === session.userId) {
      return dailyAnswerErrorResponse(403, 'forbidden', 'You can’t answer your own question.');
    }

    // deriveAnswerOutcome reads mastery history (F2.1 answer_state) and the
    // inside-joke display read (friendship check) is independent of it and of
    // the grader output, so fan them out in parallel. The viewer joke isn't
    // consumed until nextSlots is built below; pre-resolving it here removes a
    // serial round-trip.
    const basePoints = question.basePoints;
    const [{ masteryAnswerState, pointsAwarded }, insideJokeForViewer] = await Promise.all([
      deriveAnswerOutcome({
        userId: session.userId,
        canonicalQuestionId,
        isCorrect,
        // A correct answer in an unfamiliar domain default-adds it to the
        // player's Knowledge base — including bot-generated Daily Five
        // questions, which now match the authored path. The old PRD §8.4.3
        // gate (bot questions could only deepen existing domains) has been
        // removed in favour of default-add with an easy undo;
        // writeMasteryEvent's ON CONFLICT DO UPDATE opens the domain the same
        // way the authored flow does (src/app/api/questions/[id]/answer).
        pointsFor: (answerState) =>
          answerState === 'first_correct'
            ? basePoints
            : answerState === 'first_correct_after_wrong'
              ? Math.round(basePoints * RECOVERY_STATE_WEIGHT)
              : 0,
      }),
      selectInsideJokeForViewer(persistedInsideJoke, persistedCreatorId, session.userId),
    ]);

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

    const propagationKey = question.generatedId ?? question.canonicalId ?? canonicalQuestionId;
    const masteryDelta = await recordAnswerSideEffects({
      userId: session.userId,
      isCorrect,
      logTag: 'daily/answer',
      logContext: { generatedQuestionId: question.generatedId },
      masteryEvent: {
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
      },
      adaptiveDifficultyDomain: question.canonicalSubcategory,
      // Give-ups are deliberate wrongs: no author credit, no friend fan-out.
      propagation: canonicalQuestionId && !parsed.gaveUp
        ? {
            canonicalQuestionId,
            creator: { creatorId: persistedCreatorId, domain: persistedDomainForCreator },
            creditSourceId: `daily:${propagationKey}:${session.userId}`,
            creditScope: 'daily/answer',
            feedSourceId: `daily:${propagationKey}:${session.userId}`,
          }
        : null,
    });
    marks.mastery = Date.now();

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
  } finally {
    logStepTimings(marks);
  }
}
