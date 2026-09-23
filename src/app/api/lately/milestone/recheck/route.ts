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

// Recheck (dispute the grade) for a Lately milestone reveal. A milestone is not a
// feed item, so there's no feedItemId for the client to recheck against — but the
// milestone answer route writes a synthetic `milestone_missed` FeedItem on every
// wrong answer (sourceAnswerId = `milestone-miss:<questionId>`, state='answered',
// answerResult='incorrect'). That row is this dispute's anchor: we look it up by
// (recipientUserId, sourceAnswerId), reuse the exact recheck flow the feed route
// runs, and — on accept — flip it to 'correct' so the catch-up pipeline stops
// re-surfacing the miss. Authorization is by construction: the row is keyed to
// the viewer's own recipientUserId, so a tampered questionId resolves to nothing.
const bodySchema = z.object({
  questionId: z.string().trim().min(1),
  // "Argue your point" (B-ARGUE-01): optional written case, capped server-side
  // so a direct API call can't bypass the sheet's client-side maxLength.
  player_argument: z.string().trim().max(ARGUE_YOUR_POINT_MAX_LENGTH).optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized', message: 'Please sign in to request a recheck.' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'validation', message: 'questionId is required.' }, { status: 400 });
    }
    const { questionId } = parsed.data;
    const playerArgument = parsed.data.player_argument?.trim() || null;

    const sourceAnswerId = `milestone-miss:${questionId}`;
    const [row] = await db
      .select({ feedItem: feedItems, question: questions })
      .from(feedItems)
      .innerJoin(questions, eq(feedItems.questionId, questions.id))
      .where(
        and(
          eq(feedItems.recipientUserId, session.userId),
          eq(feedItems.sourceAnswerId, sourceAnswerId),
        ),
      )
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: 'not_found', message: 'We could not find that answer to recheck.' }, { status: 404 });
    }

    const { feedItem, question } = row;

    if (feedItem.state !== 'answered' || !feedItem.submittedAnswer) {
      return NextResponse.json({ error: 'invalid_state', message: 'Answer the question before requesting a recheck.' }, { status: 400 });
    }
    if (feedItem.answerResult === 'correct') {
      return NextResponse.json({ error: 'invalid_state', message: 'That answer is already marked correct.' }, { status: 400 });
    }

    const answerId = `milestone:${questionId}:${session.userId}`;
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
        // Flip the synthetic catch-up row to correct so getFeedCatchupItems stops
        // re-surfacing the miss, mirroring the feed recheck route's feedItems write.
        await tx
          .update(feedItems)
          .set({ answerResult: 'correct', pointsAwarded })
          .where(eq(feedItems.id, feedItem.id));
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
          surface: 'lately_milestone',
          playerArgument,
          reviewDecision: review.decision,
          reviewReason: review.reason,
          acceptedAlternative: review.acceptedAlternative,
          status: disputeStatus,
          reviewedAt,
        });
    });

    // §8.22 dispute path: the dispute row routes to the human-review queue on
    // its own. We deliberately do NOT write a `grade_dispute_filed` activity to
    // the question's author — that card carried no action the author could take
    // (the re-grade happens in the review queue, not on the author's stream),
    // so it was retired (2026-06-25). Mirrors feed/recheck and daily/recheck.

    if (accepted) {
      // Fix 2: fold the accepted alternative into the question's answer key so
      // the same correct-but-unlisted answer is never wronged again.
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
        sourceId: `milestone:${question.id}:recheck`,
        broadCategory: question.broadCategory,
        eventQuestionId: question.id,
        basePoints: pointsAwarded,
        weight: 1,
      }).catch((error: unknown) => {
        console.warn('[lately/milestone/recheck] writeMasteryEvent failed', error instanceof Error ? error.message : error);
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
    console.error('[lately/milestone/recheck] unexpected', error);
    return NextResponse.json({ error: 'unexpected', message: 'Could not recheck that answer.' }, { status: 500 });
  }
}
