import { and, eq, isNull, sql } from 'drizzle-orm';
import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { gradeAnswer } from '@/server/grading';
import { getSession } from '@/server/auth/session';
import { db, playerMastery, questions } from '@/server/db';
import { getBasePoints } from '@/server/mastery/scoring';
import { awardAuthorCredit } from '@/server/mastery/author-credit';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { promoteDeclaredToDemonstrated } from '@/server/knowledge/open-domain';
import { computeAnswerState } from '@/server/answer-state';
import { readPriorAnswersForQuestion } from '@/server/answer-history';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

type MasteryTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

const bodySchema = z.object({
  // Permissive: a malformed type is coerced away (matching the prior parser)
  // rather than 400-ing; the required-non-empty check happens below.
  submitted_answer: z.string().optional().catch(undefined),
  answer: z.string().optional().catch(undefined),
});

function parseBody(value: unknown): { submittedAnswer: string } | null {
  const parsed = bodySchema.safeParse(value);
  if (!parsed.success) return null;
  const { submitted_answer, answer } = parsed.data;
  const submittedAnswer = (
    typeof submitted_answer === 'string'
      ? submitted_answer
      : typeof answer === 'string'
        ? answer
        : ''
  ).trim();
  return submittedAnswer ? { submittedAnswer } : null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: questionId } = await context.params;
  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json(
      { error: 'validation', message: 'submitted_answer is required' },
      { status: 400 },
    );
  }

  const [question] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, questionId), isNull(questions.deletedAt)))
    .limit(1);

  if (!question) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (question.visibility !== 'public') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // Authors can't answer their own questions — they already know the
  // answer, so any submission would be a grading no-op (or worse, a
  // self-credit). Feed surfaces filter these out at query time, but
  // direct POSTs reach this endpoint without that gate.
  if (question.creatorId && question.creatorId === session.userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const domain = question.canonicalSubcategory || question.broadCategory || question.category;
  const grade = await gradeAnswer(
    parsed.submittedAnswer,
    question.answerText,
    question.acceptedAlternatives,
    question.questionText,
    question.questionType,
  );
  // Fail toward the player (B4 Phase 4 / Drift Risk 2): hold a grader outage for retry.
  if (grade.status === 'unscored') {
    return NextResponse.json(
      {
        error: 'grader_unavailable',
        message:
          "Our answer-checker is taking a quick breather. Your answer wasn't scored — give it another go in a moment.",
      },
      { status: 503 },
    );
  }
  const isCorrect = grade.result === 'correct';

  const priorAnswers = await readPriorAnswersForQuestion(session.userId, question.id);
  const answerState = computeAnswerState(isCorrect ? 'correct' : 'wrong', priorAnswers);

  const existingMastery = await db
    .select()
    .from(playerMastery)
    .where(and(eq(playerMastery.userId, session.userId), eq(playerMastery.canonicalSubcategory, domain)))
    .limit(1);

  const previousTier: MasteryTier = existingMastery[0]?.tier ?? 'establishing';
  const basePoints = isCorrect
    ? getBasePoints(question.calibratedDifficulty ?? question.llmDifficulty ?? null, answerState)
    : 0;
  const pointsAwarded = basePoints;
  const awardsMasteryCredit = pointsAwarded > 0;
  const sourceId = `profile:${question.id}:${session.userId}`;
  const masteryDelta = await writeMasteryEvent({
    userId: session.userId,
    questionId: question.id,
    domain,
    answerState,
    pointsAwarded,
    sourceType: 'feed',
    sourceId,
    broadCategory: question.broadCategory,
    eventQuestionId: question.id,
    basePoints,
    weight: awardsMasteryCredit ? 1 : 0,
  }).catch((error: unknown) => {
    console.warn('[questions/answer] failed to write mastery/adaptive answer event', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return {
      domain,
      broadCategory: question.broadCategory ?? null,
      points: pointsAwarded,
      previousTier,
      newTier: previousTier,
      tierChanged: false,
    };
  });

  await db.transaction(async (tx) => {
    if (awardsMasteryCredit) {
      await tx
        .update(questions)
        .set({
          askedCount: sql`${questions.askedCount} + 1`,
          correctCount: sql`${questions.correctCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(questions.id, question.id));
    } else {
      await tx
        .update(questions)
        .set({
          askedCount: sql`${questions.askedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(questions.id, question.id));
    }
  });

  if (awardsMasteryCredit && question.creatorId && session.userId !== question.creatorId) {
    void promoteDeclaredToDemonstrated({
      userId: question.creatorId,
      domain,
      triggeringFriendId: session.userId,
      questionId: question.id,
    });

    // Author credit (PRD §8.32): off the user's hot path. Pass the loaded
    // question row so the helper doesn't re-fetch.
    void awardAuthorCredit({
      creatorUserId: question.creatorId,
      answererUserId: session.userId,
      questionId: question.id,
      domain,
      sourceId,
      broadCategory: question.broadCategory,
      questionStats: {
        correctCount: question.correctCount,
        askedCount: question.askedCount,
        calibratedDifficulty: question.calibratedDifficulty,
        llmDifficulty: question.llmDifficulty,
      },
      scope: 'questions/answer',
    });
  }

  if (isCorrect) {
    after(() => createFeedItemsForFriendsFromAnswer(
      session.userId,
      question.id,
      'correct',
      sourceId,
    ));
  }

  return NextResponse.json({
    isCorrect,
    explanation: question.explainerFull ?? question.explainerBrief ?? question.factualExplanation,
    pointsAwarded,
    answerState,
    breadcrumb: null,
    masteryDelta,
    correctAnswer: question.answerText,
    creatorNote: question.creatorNote ?? null,
  });
}
