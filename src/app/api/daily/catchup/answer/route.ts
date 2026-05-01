import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { gradeAnswer } from '@/server/grading';
import { getSession } from '@/server/auth/session';
import { dailyQueues, db } from '@/server/db';
import { getCatchupQuestions } from '@/server/db/queries/daily';
import { asQueueSlots, findQueueSlotBySlotIndex, replaceQueueSlot } from '@/server/daily/catchup';
import { generateBreadcrumb } from '@/server/daily/generate-breadcrumb';
import { type QueueSlot } from '@/server/daily/types';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';

export const dynamic = 'force-dynamic';

function parseBody(value: unknown): { dailyQueueItemId: string; submittedAnswer: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const dailyQueueItemId = typeof record.dailyQueueItemId === 'string' ? record.dailyQueueItemId : null;
  const submittedAnswer = typeof record.submittedAnswer === 'string' ? record.submittedAnswer.trim() : null;
  if (!dailyQueueItemId || !submittedAnswer) return null;
  return { dailyQueueItemId, submittedAnswer };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json(
      { error: 'validation', message: 'dailyQueueItemId and submittedAnswer are required' },
      { status: 400 },
    );
  }

  const catchupItem = (await getCatchupQuestions(session.userId))
    .find((item) => item.dailyQueueItemId === parsed.dailyQueueItemId);
  if (!catchupItem) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [queue] = await db
    .select()
    .from(dailyQueues)
    .where(eq(dailyQueues.id, catchupItem.queueId))
    .limit(1);
  if (!queue || queue.userId !== session.userId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const slots = asQueueSlots(queue.slots);
  const slot = findQueueSlotBySlotIndex(slots, catchupItem.slotIndex);
  if (!slot || slot.answered || slot.dismissed_at) {
    return NextResponse.json({ error: 'invalid_state', message: 'catch-up item is already closed' }, { status: 400 });
  }

  const grade = await gradeAnswer(
    parsed.submittedAnswer,
    catchupItem.answer,
    [],
    catchupItem.questionText,
    'factual',
  );
  const isCorrect = grade.result === 'correct';
  const pointsAwarded = isCorrect ? Math.round(catchupItem.basePoints * 0.25) : 0;
  const answerState = isCorrect ? 'correct' : 'incorrect';
  const breadcrumb = await generateBreadcrumb({
    questionId: catchupItem.questionId,
    questionText: catchupItem.questionText,
    correctAnswer: catchupItem.answer,
    submittedAnswer: parsed.submittedAnswer,
    isCorrect,
    domain: catchupItem.domain,
  }).catch(() => null);

  const nextSlots = replaceQueueSlot(slots, catchupItem.slotIndex, (item) => {
    return {
      ...item,
      answered: true,
      answer_state: answerState,
      submitted_answer: parsed.submittedAnswer,
      awarded_points: pointsAwarded,
      reveal_canonical_answer: catchupItem.answer,
      reveal_explainer: catchupItem.explainer,
      reveal_breadcrumb: breadcrumb,
      reveal_quip: grade.consolation,
    } satisfies QueueSlot;
  });

  const masteryDelta = await writeMasteryEvent({
    userId: session.userId,
    questionId: catchupItem.questionId,
    domain: catchupItem.domain,
    answerState: isCorrect ? 'first_correct' : 'incorrect',
    pointsAwarded,
    sourceType: 'catchup',
    sourceId: parsed.dailyQueueItemId,
    broadCategory: catchupItem.broadCategory,
    eventQuestionId: null,
    basePoints: catchupItem.basePoints,
    weight: isCorrect ? 0.25 : 0,
  });

  await db
    .update(dailyQueues)
    .set({ slots: nextSlots })
    .where(eq(dailyQueues.id, catchupItem.queueId));

  return NextResponse.json({
    isCorrect,
    correct: isCorrect,
    pointsAwarded,
    answerState,
    breadcrumb,
    awarded_points: pointsAwarded,
    masteryDelta,
    mastery_delta: masteryDelta,
    correctAnswer: catchupItem.answer,
    answer: catchupItem.answer,
    explanation: catchupItem.explainer,
    explainer: catchupItem.explainer,
    consolation: grade.consolation,
    quip: grade.consolation,
  });
}
