import { and, eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { gradeAnswer } from '@/server/grading';
import { getSession } from '@/server/auth/session';
import { db, feedItems, masteryEvents, playerMastery, questions } from '@/server/db';
import { getBasePoints } from '@/server/mastery/awards';
import { effectiveTier } from '@/server/mastery/tiers';
import { userAnsweredQuestionCorrectly } from '@/server/db/queries/feed';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ feedItemId: string }>;
};

type MasteryTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

function parseBody(value: unknown): { submittedAnswer: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const submittedAnswer = typeof record.submitted_answer === 'string'
    ? record.submitted_answer.trim()
    : typeof record.answer === 'string'
      ? record.answer.trim()
      : null;

  return submittedAnswer ? { submittedAnswer } : null;
}

async function readAuthorCredit(userId: string, domain: string) {
  const [row] = await db
    .select({
      points: sql<number>`coalesce(sum(${masteryEvents.awardedPoints}), 0)`,
      distinctQuestions: sql<number>`count(distinct ${masteryEvents.questionId})`,
    })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.userId, userId),
      eq(masteryEvents.canonicalSubcategory, domain),
      eq(masteryEvents.sourceType, 'author_credit'),
    ));

  return {
    points: Number(row?.points ?? 0),
    distinctQuestions: Number(row?.distinctQuestions ?? 0),
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { feedItemId } = await context.params;
  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json(
      { error: 'validation', message: 'submitted_answer is required' },
      { status: 400 },
    );
  }

  const [row] = await db
    .select({ feedItem: feedItems, question: questions })
    .from(feedItems)
    .innerJoin(questions, eq(feedItems.questionId, questions.id))
    .where(and(eq(feedItems.id, feedItemId), eq(feedItems.recipientUserId, session.userId)))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.feedItem.state === 'dismissed' || row.feedItem.state === 'rolled_off' || row.feedItem.state === 'answered') {
    return NextResponse.json({ error: 'invalid_state', message: 'This Feed item is already closed.' }, { status: 400 });
  }

  const question = row.question;
  const domain = question.canonicalSubcategory || question.broadCategory || question.category;
  const grade = await gradeAnswer(
    parsed.submittedAnswer,
    question.answerText,
    question.acceptedAlternatives,
    question.questionText,
    question.questionType,
  );
  const isCorrect = grade.result === 'correct';
  const answerId = `feed:${feedItemId}`;
  const alreadyCorrect = await userAnsweredQuestionCorrectly(session.userId, question.id);

  const [existingMastery, authorCredit] = await Promise.all([
    db
      .select()
      .from(playerMastery)
      .where(and(eq(playerMastery.userId, session.userId), eq(playerMastery.canonicalSubcategory, domain)))
      .limit(1),
    readAuthorCredit(session.userId, domain),
  ]);

  const previousTier: MasteryTier = existingMastery[0]?.tier ?? 'establishing';
  const answerState = alreadyCorrect ? 'repeat_correct' : 'first_correct';
  const basePoints = isCorrect ? getBasePoints(question.calibratedDifficulty ?? question.llmDifficulty ?? null, answerState) : 0;
  const pointsAwarded = isCorrect ? basePoints : 0;
  const nextTotalPoints = (existingMastery[0]?.totalPoints ?? 0) + pointsAwarded;
  const nextTier = isCorrect
    ? effectiveTier(nextTotalPoints, authorCredit.points, authorCredit.distinctQuestions)
    : previousTier;

  await db.transaction(async (tx) => {
    if (isCorrect && !alreadyCorrect) {
      await tx
        .insert(playerMastery)
        .values({
          userId: session.userId,
          canonicalSubcategory: domain,
          broadCategory: question.broadCategory,
          totalPoints: pointsAwarded,
          tier: nextTier,
          tierReachedAt: previousTier !== nextTier ? new Date() : null,
          seasonPointsStart: 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [playerMastery.userId, playerMastery.canonicalSubcategory],
          set: {
            broadCategory: question.broadCategory,
            totalPoints: nextTotalPoints,
            tier: nextTier,
            tierReachedAt: previousTier !== nextTier ? new Date() : existingMastery[0]?.tierReachedAt ?? null,
            updatedAt: new Date(),
          },
        });

      await tx.insert(masteryEvents).values({
        userId: session.userId,
        canonicalSubcategory: domain,
        sourceType: 'live_correct',
        questionId: question.id,
        answeredByUserId: session.userId,
        answerId,
        basePoints,
        weight: 1,
        awardedPoints: pointsAwarded,
        answerState,
        sessionContext: 'feed',
      });

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

    await tx
      .update(feedItems)
      .set({ state: 'answered' })
      .where(eq(feedItems.id, feedItemId));
  });

  return NextResponse.json({
    isCorrect,
    correct: isCorrect,
    explanation: question.explainerFull ?? question.explainerBrief ?? question.factualExplanation,
    pointsAwarded,
    awarded_points: pointsAwarded,
    masteryDelta: {
      domain,
      points: pointsAwarded,
      previousTier,
      newTier: nextTier,
      tierChanged: previousTier !== nextTier,
    },
    mastery_delta: {
      domain,
      points: pointsAwarded,
      previousTier,
      newTier: nextTier,
      tierChanged: previousTier !== nextTier,
    },
    correctAnswer: question.answerText,
    answer: question.answerText,
    consolation: grade.consolation,
    quip: grade.consolation,
  });
}
