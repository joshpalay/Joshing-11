import { and, eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { gradeAnswer, selectQuip } from '@/server/grading';
import { getSession } from '@/server/auth/session';
import { promptCreatorNoteAfterWrongAnswer } from '@/server/creator-notes';
import { db, feedItems, playerMastery, questions, users } from '@/server/db';
import { generateBreadcrumb } from '@/server/daily/generate-breadcrumb';
import { getBasePoints } from '@/server/mastery/awards';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { userAnsweredQuestionCorrectly } from '@/server/db/queries/feed';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { promoteDeclaredToDemonstrated } from '@/server/knowledge/open-domain';

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
    .select({ feedItem: feedItems, question: questions, sourceDisplayName: users.displayName })
    .from(feedItems)
    .innerJoin(questions, eq(feedItems.questionId, questions.id))
    .leftJoin(users, eq(feedItems.sourceUserId, users.id))
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
  const rawSource = row.feedItem.sourceResult;
  const friendResult = (rawSource === 'correct' || rawSource === 'incorrect') ? rawSource : null;
  const friendName = row.sourceDisplayName ?? undefined;
  const quip = selectQuip({ isCorrect, surface: 'feed', friendResult, friendName });
  const alreadyCorrect = await userAnsweredQuestionCorrectly(session.userId, question.id);

  const existingMastery = await db
    .select()
    .from(playerMastery)
    .where(and(eq(playerMastery.userId, session.userId), eq(playerMastery.canonicalSubcategory, domain)))
    .limit(1);

  const previousTier: MasteryTier = existingMastery[0]?.tier ?? 'establishing';
  const answerState = isCorrect ? (alreadyCorrect ? 'repeat_correct' : 'first_correct') : 'incorrect';
  const basePoints = isCorrect ? getBasePoints(question.calibratedDifficulty ?? question.llmDifficulty ?? null, answerState) : 0;
  const pointsAwarded = isCorrect ? basePoints : 0;
  const breadcrumb = await generateBreadcrumb({
    questionId: question.id,
    questionText: question.questionText,
    correctAnswer: question.answerText,
    submittedAnswer: parsed.submittedAnswer,
    isCorrect,
    domain,
  }).catch(() => null);
  const masteryDelta = await writeMasteryEvent({
    userId: session.userId,
    questionId: question.id,
    domain,
    answerState,
    pointsAwarded: isCorrect && !alreadyCorrect ? pointsAwarded : 0,
    sourceType: 'feed',
    sourceId: feedItemId,
    broadCategory: question.broadCategory,
    eventQuestionId: isCorrect && !alreadyCorrect ? question.id : null,
    basePoints,
    weight: isCorrect && !alreadyCorrect ? 1 : 0,
  }).catch((error: unknown) => {
    console.warn('[feed/answer] failed to write mastery/adaptive answer event', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return {
      domain,
      points: pointsAwarded,
      previousTier,
      newTier: previousTier,
      tierChanged: false,
    };
  });

  await db.transaction(async (tx) => {
    if (isCorrect && !alreadyCorrect) {
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
      .set({
        state: 'answered',
        submittedAnswer: parsed.submittedAnswer,
        answerResult: isCorrect ? 'correct' : 'incorrect',
        pointsAwarded: pointsAwarded,
        masteryDelta: masteryDelta as Record<string, unknown>,
        quip,
      })
      .where(eq(feedItems.id, feedItemId));
  });

  // Promote author's declared territory to demonstrated when a non-author answers correctly
  if (isCorrect && !alreadyCorrect && question.creatorId && session.userId !== question.creatorId) {
    void promoteDeclaredToDemonstrated({
      userId: question.creatorId,
      domain,
      triggeringFriendId: session.userId,
      questionId: question.id,
    });
  }

  // Only correct Feed answers are eligible to become public/social friend Feed cards.
  // Incorrect answers persist privately on this viewer's Feed item as answered_by_you.
  if (isCorrect) {
    await createFeedItemsForFriendsFromAnswer(
      session.userId,
      question.id,
      'correct',
      `feed:${feedItemId}:${session.userId}`,
    );
  }

  if (!isCorrect) {
    void promptCreatorNoteAfterWrongAnswer({
      questionId: question.id,
      recipientUserId: session.userId,
      contextType: 'feed',
      contextId: feedItemId,
    });
  }

  return NextResponse.json({
    isCorrect,
    explanation: question.explainerFull ?? question.explainerBrief ?? question.factualExplanation,
    pointsAwarded,
    answerState,
    breadcrumb,
    masteryDelta,
    correctAnswer: question.answerText,
    quip,
  });
}
