import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { db, feedItems, gradeDisputes, questions } from '@/server/db';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { getBasePoints } from '@/server/mastery/scoring';
import { recheckAnswerWithLLM, resolveRecheckOutcome } from '@/server/llm/recheck';
import { recordAcceptedAlternative } from '@/server/answers/record-accepted-alternative';
import { consumeRecheckQuota, getRecheckQuotaRemaining, RECHECK_DAILY_LIMIT } from '@/server/answers/recheck-quota';
import { ARGUE_YOUR_POINT_MAX_LENGTH } from '@/lib/recheck-copy';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ feedItemId: string }>;
};

// "Argue your point" (B-ARGUE-01): optional written case, capped server-side
// so a direct API call can't bypass the sheet's client-side maxLength. This
// route previously took no body at all (feedItemId came from the URL); the
// body is now optional JSON rather than required.
const bodySchema = z.object({
  player_argument: z.string().trim().max(ARGUE_YOUR_POINT_MAX_LENGTH).optional().nullable(),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized', message: 'Please sign in to request a recheck.' }, { status: 401 });
    }

    const parsedBody = bodySchema.safeParse(await request.json().catch(() => ({})));
    const playerArgument = parsedBody.success ? parsedBody.data.player_argument?.trim() || null : null;

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

    const quotaBefore = await getRecheckQuotaRemaining(session.userId);
    if (quotaBefore <= 0) {
      return NextResponse.json(
        {
          error: 'rate_limited',
          message: `You've used all ${RECHECK_DAILY_LIMIT} rechecks for today. Try again tomorrow.`,
        },
        { status: 429 },
      );
    }

    const canonicalAnswer = question.answerText;
    const review = await recheckAnswerWithLLM({
      questionText: question.questionText,
      canonicalAnswer,
      submittedAnswer: feedItem.submittedAnswer,
      questionType: 'factual',
      acceptedAlternatives: question.acceptedAlternatives ?? [],
      playerArgument,
    });

    const { accepted, recheckStatus, disputeStatus } = resolveRecheckOutcome(review.decision);
    const reviewedAt = accepted ? new Date() : null;
    const domain = question.canonicalSubcategory || question.broadCategory || question.category;

    let pointsAwarded = 0;
    if (accepted) {
      pointsAwarded = getBasePoints(question.calibratedDifficulty ?? question.llmDifficulty ?? null, 'first_correct');
    }

    await db.transaction(async (tx) => {
      if (accepted) {
        await tx
          .update(feedItems)
          .set({ answerResult: 'correct', pointsAwarded })
          .where(eq(feedItems.id, feedItemId));
      }

      await tx
        .insert(gradeDisputes)
        .values({
          answerId,
          questionId: question.id,
          creatorId: session.userId,
          submittedAnswer: feedItem.submittedAnswer ?? '',
          canonicalAnswer,
          questionText: question.questionText,
          surface: 'feed',
          playerArgument,
          reviewDecision: review.decision,
          reviewReason: review.reason,
          acceptedAlternative: review.acceptedAlternative,
          status: disputeStatus,
          reviewedAt,
        });
    });

    // §8.22 dispute path: the dispute row routes to the human-review queue
    // (status 'pending'/'needs_human') on its own. We deliberately do NOT write
    // a `grade_dispute_filed` activity to the question's author — that card
    // carried no action the author could take (the re-grade happens in the
    // review queue, not on the author's stream), so it was retired
    // (2026-06-25). The daily/recheck path already files disputes without
    // notifying the author; this brings feed/recheck in line.

    if (accepted) {
      // Fix 2: fold the accepted alternative into the question's answer key so
      // the same correct-but-unlisted answer is never wronged (and re-appealed)
      // again. Best-effort; never throws.
      await recordAcceptedAlternative({
        canonicalQuestionId: question.id,
        generatedQuestionId: question.generatedQuestionId,
        alternative: review.acceptedAlternative,
      });

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

    const { remaining: rechecksRemaining } = await consumeRecheckQuota(session.userId);

    return NextResponse.json({
      accepted,
      status: recheckStatus,
      reason: review.reason,
      pointsAwarded,
      correctAnswer: canonicalAnswer,
      rechecksRemaining,
    });
  } catch (error) {
    console.error('[feed/recheck] unexpected', error);
    return NextResponse.json({ error: 'unexpected', message: 'Could not recheck that answer.' }, { status: 500 });
  }
}
