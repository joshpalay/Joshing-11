import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { writeActivity } from '@/server/activity/write-activity';
import { db, feedItems, gradeDisputes, questions } from '@/server/db';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { getBasePoints } from '@/server/mastery/scoring';
import { recheckAnswerWithLLM } from '@/server/llm/recheck';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ feedItemId: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized', message: 'Please sign in to request a recheck.' }, { status: 401 });
    }

    const { feedItemId } = await context.params;

    const [row] = await db
      .select({ feedItem: feedItems, question: questions })
      .from(feedItems)
      .innerJoin(questions, eq(feedItems.questionId, questions.id))
      .where(and(eq(feedItems.id, feedItemId), eq(feedItems.recipientUserId, session.userId)))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: 'not_found', message: 'We could not find that Feed item.' }, { status: 404 });
    }

    const { feedItem, question } = row;

    if (feedItem.state !== 'answered' || !feedItem.submittedAnswer) {
      return NextResponse.json({ error: 'invalid_state', message: 'Answer the question before requesting a recheck.' }, { status: 400 });
    }
    if (feedItem.answerResult === 'correct') {
      return NextResponse.json({ error: 'invalid_state', message: 'That answer is already marked correct.' }, { status: 400 });
    }

    const answerId = `feed:${feedItemId}:${session.userId}`;
    const [existingDispute] = await db
      .select({ id: gradeDisputes.id })
      .from(gradeDisputes)
      .where(eq(gradeDisputes.answerId, answerId))
      .limit(1);

    if (existingDispute) {
      return NextResponse.json({ error: 'invalid_state', message: 'That answer has already been rechecked.' }, { status: 400 });
    }

    const canonicalAnswer = question.answerText;
    const review = await recheckAnswerWithLLM({
      questionText: question.questionText,
      canonicalAnswer,
      submittedAnswer: feedItem.submittedAnswer,
      questionType: 'factual',
      acceptedAlternatives: question.acceptedAlternatives ?? [],
    });

    const accepted = review.decision === 'accept';
    const recheckStatus = accepted ? 'accepted' : review.decision === 'reject' ? 'rejected' : 'needs_human';
    const disputeStatus = accepted ? 'alternative_added' : review.decision === 'reject' ? 'dismissed' : 'pending';
    const domain = question.canonicalSubcategory || question.broadCategory || question.category;

    let pointsAwarded = 0;
    if (accepted) {
      pointsAwarded = getBasePoints(question.calibratedDifficulty ?? question.llmDifficulty ?? null, 'first_correct');
    }

    const disputeId = await db.transaction(async (tx) => {
      if (accepted) {
        await tx
          .update(feedItems)
          .set({ answerResult: 'correct', pointsAwarded })
          .where(eq(feedItems.id, feedItemId));
      }

      const [inserted] = await tx
        .insert(gradeDisputes)
        .values({
          answerId,
          questionId: question.id,
          creatorId: session.userId,
          submittedAnswer: feedItem.submittedAnswer ?? '',
          canonicalAnswer,
          questionText: question.questionText,
          surface: 'feed',
          reviewDecision: review.decision,
          reviewReason: review.reason,
          acceptedAlternative: review.acceptedAlternative,
          status: disputeStatus,
          reviewedAt: review.decision === 'needs_human' ? null : new Date(),
        })
        .returning({ id: gradeDisputes.id });
      return inserted?.id ?? null;
    });

    // §8.22 dispute path: notify the question's author so they can review.
    // The dispute is the answerer's explicit ask for a second look, which
    // is the consent gate that lets the author see the literal submitted
    // text alongside the canonical answer.
    if (disputeId && question.creatorId && question.creatorId !== session.userId) {
      await writeActivity({
        userId: question.creatorId,
        type: 'grade_dispute_filed',
        actorUserId: session.userId,
        referenceId: disputeId,
        referenceType: 'grade_dispute',
      });
    }

    if (accepted) {
      await writeMasteryEvent({
        userId: session.userId,
        questionId: question.id,
        domain,
        answerState: 'first_correct',
        pointsAwarded,
        sourceType: 'feed',
        sourceId: `${feedItemId}:recheck`,
        broadCategory: question.broadCategory,
        eventQuestionId: question.id,
        basePoints: pointsAwarded,
        weight: 1,
      }).catch((error: unknown) => {
        console.warn('[feed/recheck] writeMasteryEvent failed', error instanceof Error ? error.message : error);
      });
    }

    return NextResponse.json({
      accepted,
      status: recheckStatus,
      reason: review.reason,
      pointsAwarded,
      correctAnswer: canonicalAnswer,
    });
  } catch (error) {
    console.error('[feed/recheck] unexpected', error);
    return NextResponse.json({ error: 'unexpected', message: 'Could not recheck that answer.' }, { status: 500 });
  }
}
