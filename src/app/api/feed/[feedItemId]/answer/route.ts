import { and, eq, sql } from 'drizzle-orm';
import { after, NextRequest, NextResponse } from 'next/server';

import { gradeAnswer } from '@/server/grading';
import { getSession } from '@/server/auth/session';
import { db, feedItems, playerMastery, questions, users } from '@/server/db';
import { getBasePoints } from '@/server/mastery/scoring';
import { awardAuthorCredit } from '@/server/mastery/author-credit';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { promoteDeclaredToDemonstrated } from '@/server/knowledge/open-domain';
import { computeAnswerState } from '@/server/answer-state';
import { readPriorAnswersForQuestion } from '@/server/answer-history';
import { selectInsideJokeForViewer } from '@/server/questions/inside-joke';
import { getFeedItemAnswerForRecipient } from '@/server/db/queries/feed';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ feedItemId: string }>;
};

// Reveal a feed item's answer for the dismissed-card "back of the card" view.
// The only input is the path param, so there is no body to validate (matching
// the sibling recheck route). Recipient scoping lives in the query helper.
export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { feedItemId } = await context.params;
  const reveal = await getFeedItemAnswerForRecipient(feedItemId, session.userId);
  if (!reveal) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ answer: reveal.answer, questionText: reveal.questionText });
}

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
  if (row.feedItem.state === 'dismissed' || row.feedItem.state === 'rolled_off') {
    return NextResponse.json({ error: 'invalid_state', message: 'This Feed item is already closed.' }, { status: 400 });
  }
  // direct_sent questions are personal asks from a specific friend. A wrong
  // answer keeps the card actionable so the recipient can take another swing
  // without leaving the feed. Other source types — including direct_sent
  // that were already answered correctly — stay closed once answered.
  if (row.feedItem.state === 'answered') {
    const allowRetry =
      row.feedItem.sourceType === 'direct_sent'
      && row.feedItem.answerResult === 'incorrect';
    if (!allowRetry) {
      return NextResponse.json({ error: 'invalid_state', message: 'This Feed item is already closed.' }, { status: 400 });
    }
  }

  const question = row.question;
  // Authors can't answer their own questions. The feed query helper at
  // src/server/db/queries/feed.ts:334 already excludes authored items
  // from the feed surface, but a stale FeedItem row id sent directly
  // here would still otherwise be accepted.
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
  // Fail toward the player (B4 Phase 4 / Drift Risk 2): a grader outage is not a
  // real verdict — never mark a friend's question wrong. Return a retryable 503.
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

  // F2.3: compute answer_state against the user's prior history on this
  // canonical question so first_correct_after_wrong (recovery) is detected
  // instead of being collapsed into first_correct. getBasePoints returns the
  // correct state-adjusted credit (full for first_correct, 0.25x for
  // first_correct_after_wrong, 0 for repeat_correct / incorrect).
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
  const masteryDelta = await writeMasteryEvent({
    userId: session.userId,
    questionId: question.id,
    domain,
    answerState,
    pointsAwarded,
    sourceType: 'feed',
    sourceId: feedItemId,
    broadCategory: question.broadCategory,
    eventQuestionId: question.id,
    basePoints,
    weight: awardsMasteryCredit ? 1 : 0,
  }).catch((error: unknown) => {
    console.warn('[feed/answer] failed to write mastery/adaptive answer event', {
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

    await tx
      .update(feedItems)
      .set({
        state: 'answered',
        submittedAnswer: parsed.submittedAnswer,
        answerResult: isCorrect ? 'correct' : 'incorrect',
        pointsAwarded: pointsAwarded,
        masteryDelta: masteryDelta as Record<string, unknown>,
      })
      .where(eq(feedItems.id, feedItemId));
  });

  // Promote author's declared territory to demonstrated when a non-author
  // gets the question right for the first time (first_correct OR recovery —
  // both award mastery credit, both mean "this friend has now demonstrated
  // knowledge here").
  if (awardsMasteryCredit && question.creatorId && session.userId !== question.creatorId) {
    void promoteDeclaredToDemonstrated({
      userId: question.creatorId,
      domain,
      triggeringFriendId: session.userId,
      questionId: question.id,
    });

    // Author credit (PRD §8.32): off the user's hot path. We pass the
    // question row we already loaded so the helper doesn't re-fetch it.
    void awardAuthorCredit({
      creatorUserId: question.creatorId,
      answererUserId: session.userId,
      questionId: question.id,
      domain,
      sourceId: feedItemId,
      broadCategory: question.broadCategory,
      questionStats: {
        correctCount: question.correctCount,
        askedCount: question.askedCount,
        calibratedDifficulty: question.calibratedDifficulty,
        llmDifficulty: question.llmDifficulty,
      },
      scope: 'feed/answer',
    });
  }

  // Only correct Feed answers are eligible to become public/social friend Feed cards.
  // Incorrect answers persist privately on this viewer's Feed item as answered_by_you.
  if (isCorrect) {
    after(() => createFeedItemsForFriendsFromAnswer(
      session.userId,
      question.id,
      'correct',
      `feed:${feedItemId}:${session.userId}`,
    ));
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
    // Flags an author-written answer the LLM never confirmed, so the reveal can
    // tag it. Only authored questions carry this; curated/house answers default
    // to 'verified'. The legacy `verified` boolean mirrors `status`.
    unverified: question.status === 'unverified',
    creatorNote: question.creatorNote ?? null,
    insideJoke: insideJoke?.text ?? null,
    insideJokeKind: insideJoke?.kind ?? null,
  });
}
