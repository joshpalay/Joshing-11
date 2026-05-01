import { and, eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { gradeAnswer } from '@/server/grading';
import { getSession } from '@/server/auth/session';
import {
  dailyQueues,
  db,
  generatedQuestions,
  masteryEvents,
  playerMastery,
} from '@/server/db';
import { effectiveTier } from '@/server/mastery/tiers';
import { PERSONAL_DAILY_SESSION_CONTEXT, type QueueSlot } from '@/server/daily/types';

export const dynamic = 'force-dynamic';

type MasteryTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

function parseBody(value: unknown): { queueId: string; slotIndex: number; submittedAnswer: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const queueId = typeof record.queue_id === 'string' ? record.queue_id : null;
  const slotIndex = typeof record.slot_index === 'number' && Number.isInteger(record.slot_index)
    ? record.slot_index
    : null;
  const submittedAnswer = typeof record.submitted_answer === 'string'
    ? record.submitted_answer.trim()
    : typeof record.answer === 'string'
      ? record.answer.trim()
      : null;

  if (!queueId || slotIndex === null || !submittedAnswer) return null;
  return { queueId, slotIndex, submittedAnswer };
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

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json(
      { error: 'validation', message: 'queue_id, slot_index, and submitted_answer are required' },
      { status: 400 },
    );
  }

  const [queue] = await db
    .select()
    .from(dailyQueues)
    .where(and(eq(dailyQueues.id, parsed.queueId), eq(dailyQueues.userId, session.userId)))
    .limit(1);

  if (!queue) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const slots = asQueueSlots(queue.slots);
  const slot = slots[parsed.slotIndex];
  if (!slot) {
    return NextResponse.json({ error: 'validation', message: 'slot_index out of range' }, { status: 400 });
  }
  if (slot.answered || slot.skipped) {
    return NextResponse.json({ error: 'invalid_state', message: 'slot is already closed' }, { status: 400 });
  }
  if (!slot.generated_question_id) {
    return NextResponse.json({ error: 'invalid_state', message: 'daily slot has no generated question' }, { status: 400 });
  }

  const [question] = await db
    .select()
    .from(generatedQuestions)
    .where(and(
      eq(generatedQuestions.id, slot.generated_question_id),
      eq(generatedQuestions.userId, session.userId),
    ))
    .limit(1);

  if (!question) return NextResponse.json({ error: 'question_not_found' }, { status: 404 });

  const grade = await gradeAnswer(
    parsed.submittedAnswer,
    question.answer,
    [],
    question.questionText,
    'factual',
  );
  const isCorrect = grade.result === 'correct';
  const pointsAwarded = isCorrect ? Math.round(question.basePoints) : 0;
  const answerId = `daily:${queue.id}:${parsed.slotIndex}`;

  const [existingMastery, authorCredit] = await Promise.all([
    db
      .select()
      .from(playerMastery)
      .where(and(
        eq(playerMastery.userId, session.userId),
        eq(playerMastery.canonicalSubcategory, question.canonicalSubcategory),
      ))
      .limit(1),
    readAuthorCredit(session.userId, question.canonicalSubcategory),
  ]);

  const previousTier: MasteryTier = existingMastery[0]?.tier ?? 'establishing';
  const nextTotalPoints = (existingMastery[0]?.totalPoints ?? 0) + pointsAwarded;
  const nextTier = isCorrect
    ? effectiveTier(nextTotalPoints, authorCredit.points, authorCredit.distinctQuestions)
    : previousTier;
  const masteryDelta = isCorrect
    ? {
        domain: question.canonicalSubcategory,
        points: pointsAwarded,
        previousTier,
        newTier: nextTier,
        tierChanged: previousTier !== nextTier,
      }
    : {
        domain: question.canonicalSubcategory,
        points: 0,
        previousTier,
        newTier: previousTier,
        tierChanged: false,
      };

  const nextSlots = slots.map((item, index) => {
    if (index !== parsed.slotIndex) return item;
    return {
      ...item,
      answered: true,
      answer_state: isCorrect ? 'correct' : 'incorrect',
      submitted_answer: parsed.submittedAnswer,
      awarded_points: pointsAwarded,
      reveal_canonical_answer: question.answer,
      reveal_explainer: question.explainer,
      reveal_quip: grade.consolation,
    } satisfies QueueSlot;
  });

  await db.transaction(async (tx) => {
    await tx.insert(masteryEvents).values({
      userId: session.userId,
      canonicalSubcategory: question.canonicalSubcategory,
      sourceType: 'live_correct',
      questionId: null,
      answeredByUserId: session.userId,
      answerId,
      basePoints: question.basePoints,
      weight: 1,
      awardedPoints: pointsAwarded,
      answerState: isCorrect ? 'first_correct' : 'incorrect',
      sessionContext: PERSONAL_DAILY_SESSION_CONTEXT,
    });

    if (isCorrect) {
      await tx
        .insert(playerMastery)
        .values({
          userId: session.userId,
          canonicalSubcategory: question.canonicalSubcategory,
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
    }

    await tx
      .update(dailyQueues)
      .set({ slots: nextSlots })
      .where(eq(dailyQueues.id, queue.id));
  });

  return NextResponse.json({
    isCorrect,
    explanation: question.explainer,
    pointsAwarded,
    masteryDelta,
    correctAnswer: question.answer,
    consolation: grade.consolation,
    correct: isCorrect,
    answer: question.answer,
    explainer: question.explainer,
    awarded_points: pointsAwarded,
    mastery_delta: masteryDelta,
    quip: grade.consolation,
  });
}
