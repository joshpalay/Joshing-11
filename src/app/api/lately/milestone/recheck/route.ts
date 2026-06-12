import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { writeActivity } from '@/server/activity/write-activity';
import { db, feedItems, gradeDisputes, questions } from '@/server/db';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { getBasePoints } from '@/server/mastery/scoring';
import { recheckAnswerWithLLM } from '@/server/llm/recheck';

export const dynamic = 'force-dynamic';

// "Challenge the response" for a milestone question the viewer just missed.
//
// A wrong milestone answer persists a synthetic `milestone_missed` FeedItem
// (see /api/lately/milestone/answer), keyed deterministically by
// (recipientUserId, sourceAnswerId='milestone-miss:<questionId>'). That row
// carries the submitted answer + the incorrect verdict, so a recheck here is
// the exact same flow as the feed recheck — we just resolve the row by its
// milestone key instead of a feed-item id. Mirrors
// /api/feed/[feedItemId]/recheck.
const recheckSchema = z.object({
  questionId: z.string().trim().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Please sign in to request a recheck.' },
        { status: 401 },
      );
    }

    const parsed = recheckSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation', message: 'questionId is required.' },
        { status: 400 },
      );
    }
    const { questionId } = parsed.data;

    // Resolve the viewer's own milestone-miss row by its deterministic key.
    const [row] = await db
      .select({ feedItem: feedItems, question: questions })
      .from(feedItems)
      .innerJoin(questions, eq(feedItems.questionId, questions.id))
      .where(
        and(
          eq(feedItems.recipientUserId, session.userId),
          eq(feedItems.sourceAnswerId, `milestone-miss:${questionId}`),
        ),
      )
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { error: 'not_found', message: 'We could not find that answer to recheck.' },
        { status: 404 },
      );
    }

    const { feedItem, question } = row;

    if (feedItem.state !== 'answered' || !feedItem.submittedAnswer) {
      return NextResponse.json(
        { error: 'invalid_state', message: 'Answer the question before requesting a recheck.' },
        { status: 400 },
      );
    }
    if (feedItem.answerResult === 'correct') {
      return NextResponse.json(
        { error: 'invalid_state', message: 'That answer is already marked correct.' },
        { status: 400 },
      );
    }

    const answerId = `milestone:${questionId}:${session.userId}`;
    const [existingDispute] = await db
      .select({ id: gradeDisputes.id })
      .from(gradeDisputes)
      .where(eq(gradeDisputes.answerId, answerId))
      .limit(1);

    if (existingDispute) {
      return NextResponse.json(
        { error: 'invalid_state', message: 'That answer has already been rechecked.' },
        { status: 400 },
      );
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
    const disputeStatus = accepted ? 'alternative_added' : 'pending';
    const reviewedAt = accepted ? new Date() : null;
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
          .where(eq(feedItems.id, feedItem.id));
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
          surface: 'milestone',
          reviewDecision: review.decision,
          reviewReason: review.reason,
          acceptedAlternative: review.acceptedAlternative,
          status: disputeStatus,
          reviewedAt,
        })
        .returning({ id: gradeDisputes.id });
      return inserted?.id ?? null;
    });

    // §8.22 dispute path: notify the question's author so they can review.
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
        sourceId: `milestone:${questionId}:recheck`,
        broadCategory: question.broadCategory,
        eventQuestionId: question.id,
        basePoints: pointsAwarded,
        weight: 1,
      }).catch((error: unknown) => {
        console.warn('[lately/milestone/recheck] writeMasteryEvent failed', error instanceof Error ? error.message : error);
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
    console.error('[lately/milestone/recheck] unexpected', error);
    return NextResponse.json(
      { error: 'unexpected', message: 'Could not recheck that answer.' },
      { status: 500 },
    );
  }
}
