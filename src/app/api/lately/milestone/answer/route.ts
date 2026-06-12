import { and, eq, sql } from 'drizzle-orm';
import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// B-ANSWER-PIPELINE-01: answer_state/points derive through the shared
// pipeline; the side-effect tail stays inline (feed-route parity by design,
// plus this route's milestone_missed catch-up write on a wrong answer).
import { deriveAnswerOutcome } from '@/server/answers/answer-pipeline';
import { getSession } from '@/server/auth/session';
import { db, feedItems, playerMastery, questions } from '@/server/db';
import { getSeededPlayQuestions } from '@/server/db/queries/lately';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { gradeAnswer } from '@/server/grading';
import { promoteDeclaredToDemonstrated } from '@/server/knowledge/open-domain';
import { awardAuthorCredit } from '@/server/mastery/author-credit';
import { getBasePoints } from '@/server/mastery/scoring';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { selectInsideJokeForViewer } from '@/server/questions/inside-joke';

export const dynamic = 'force-dynamic';

type MasteryTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

// D-4 CORRECTION 2: answering a friend's milestone question, in place, from the
// unified activity stream. This is the FULL-CREDIT path (superseding the
// practice-only seeded-session grade route) — it writes the SAME mastery records
// a feed answer would, so the existing answer_state dedup applies verbatim:
// re-answering a question the viewer already got right computes `repeat_correct`,
// which scores 0 base points. There is no FeedItem row to update (a milestone is
// not a feed item for the viewer), so this route does everything the feed answer
// route does EXCEPT that feedItems write.
const answerSchema = z.object({
  questionId: z.string().trim().min(1),
  submitted_answer: z.string().trim().min(1),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = answerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', message: 'questionId and submitted_answer are required' },
      { status: 400 },
    );
  }
  const submittedAnswer = parsed.data.submitted_answer;

  // Authorization is by construction: getSeededPlayQuestions only resolves
  // questions that appear in THIS viewer's own derived milestones. A tampered
  // id resolves to nothing and 404s here, exactly like the seeded play grade.
  const [authorized] = await getSeededPlayQuestions(session.userId, [parsed.data.questionId]);
  if (!authorized) {
    return NextResponse.json({ error: 'not_found', message: 'Question not available' }, { status: 404 });
  }

  const [question] = await db
    .select()
    .from(questions)
    .where(eq(questions.id, parsed.data.questionId))
    .limit(1);
  if (!question) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // You can't answer (and earn credit on) your own authored question — that case
  // is "send it onward", not "answer", under the relationship rule.
  if (question.creatorId && question.creatorId === session.userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const domain = question.canonicalSubcategory || question.broadCategory || question.category;
  const grade = await gradeAnswer(
    submittedAnswer,
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

  // F2.3 parity with the feed route: state-adjusted credit against prior history
  // on this canonical question — full for first_correct, 0.25x for recovery,
  // ZERO for repeat_correct (this is the no-double-credit guarantee).
  const { masteryAnswerState: answerState, pointsAwarded } = await deriveAnswerOutcome({
    userId: session.userId,
    canonicalQuestionId: question.id,
    isCorrect,
    pointsFor: (state) =>
      isCorrect
        ? getBasePoints(question.calibratedDifficulty ?? question.llmDifficulty ?? null, state)
        : 0,
  });

  const existingMastery = await db
    .select()
    .from(playerMastery)
    .where(and(eq(playerMastery.userId, session.userId), eq(playerMastery.canonicalSubcategory, domain)))
    .limit(1);
  const previousTier: MasteryTier = existingMastery[0]?.tier ?? 'establishing';

  const basePoints = pointsAwarded;
  const awardsMasteryCredit = pointsAwarded > 0;

  const masteryDelta = await writeMasteryEvent({
    userId: session.userId,
    questionId: question.id,
    domain,
    answerState,
    pointsAwarded,
    sourceType: 'feed',
    sourceId: `milestone:${question.id}`,
    broadCategory: question.broadCategory,
    eventQuestionId: question.id,
    basePoints,
    weight: awardsMasteryCredit ? 1 : 0,
  }).catch((error: unknown) => {
    console.warn('[lately/milestone/answer] failed to write mastery event', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return {
      domain,
      broadCategory: question.broadCategory ?? null,
      points: pointsAwarded,
      previousTier,
      newTier: previousTier,
      tierChanged: false,
      openedNewTerritory: false,
    };
  });

  // Bump question stats the same way the feed answer route does, so a milestone
  // answer leaves the same trail as any other answer of this question.
  if (awardsMasteryCredit) {
    await db
      .update(questions)
      .set({
        askedCount: sql`${questions.askedCount} + 1`,
        correctCount: sql`${questions.correctCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(questions.id, question.id));
  } else {
    await db
      .update(questions)
      .set({ askedCount: sql`${questions.askedCount} + 1`, updatedAt: new Date() })
      .where(eq(questions.id, question.id));
  }

  if (awardsMasteryCredit && question.creatorId && session.userId !== question.creatorId) {
    void promoteDeclaredToDemonstrated({
      userId: question.creatorId,
      domain,
      triggeringFriendId: session.userId,
      questionId: question.id,
    });
    void awardAuthorCredit({
      creatorUserId: question.creatorId,
      answererUserId: session.userId,
      questionId: question.id,
      domain,
      sourceId: `milestone:${question.id}`,
      broadCategory: question.broadCategory,
      questionStats: {
        correctCount: question.correctCount,
        askedCount: question.askedCount,
        calibratedDifficulty: question.calibratedDifficulty,
        llmDifficulty: question.llmDifficulty,
      },
      scope: 'lately/milestone/answer',
    });
  }

  if (isCorrect) {
    after(() => createFeedItemsForFriendsFromAnswer(
      session.userId,
      question.id,
      'correct',
      `milestone:${question.id}:${session.userId}`,
    ));
  } else {
    // A milestone is a read-derived roll-up, not a feed card, so a wrong answer
    // here leaves no FeedItem — and catch up only surfaces incorrect, unresolved
    // FeedItem rows (getFeedCatchupItems). Write a synthetic answered/incorrect
    // row so the existing feed catch-up pipeline gives the viewer a second swing.
    // state='answered' keeps it OUT of the actionable feed (which only shows
    // active/skipped), and the deterministic sourceAnswerId + onConflictDoNothing
    // guarantees one row per (viewer, question): re-missing never resets the
    // catch-up clock or resurrects an already-resolved miss. A failure here must
    // never fail the answer itself.
    try {
      await db
        .insert(feedItems)
        .values({
          recipientUserId: session.userId,
          questionId: question.id,
          sourceType: 'milestone_missed',
          // sourceUserId is NOT NULL + FK; the friend whose milestone surfaced
          // this isn't reliably in scope here, so attribute to the question
          // author (the natural "source"), falling back to the viewer for
          // author-less LLM questions. Catch up does not read this field.
          sourceUserId: question.creatorId ?? session.userId,
          sourceResult: 'incorrect',
          sourceEventAt: new Date(),
          submittedAnswer,
          answerResult: 'incorrect',
          sourceAnswerId: `milestone-miss:${question.id}`,
          state: 'answered',
        })
        .onConflictDoNothing({
          target: [feedItems.recipientUserId, feedItems.sourceAnswerId],
        });
    } catch (error) {
      console.warn('[lately/milestone/answer] failed to write catch-up feed item', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  const explanation = isCorrect
    ? (question.explainerFullCorrect ?? question.explainerFull ?? question.explainerBrief ?? question.factualExplanation)
    : (question.explainerFullWrong ?? question.explainerFull ?? question.explainerBrief ?? question.factualExplanation);

  const insideJoke = await selectInsideJokeForViewer(question.insideJoke, question.creatorId, session.userId);

  return NextResponse.json({
    isCorrect,
    explanation,
    pointsAwarded,
    answerState,
    breadcrumb: null,
    masteryDelta,
    correctAnswer: question.answerText,
    creatorNote: question.creatorNote ?? null,
    insideJoke: insideJoke?.text ?? null,
    insideJokeKind: insideJoke?.kind ?? null,
  });
}
