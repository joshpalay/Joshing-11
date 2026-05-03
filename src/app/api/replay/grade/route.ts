import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { asQueueSlots, findQueueSlotBySlotIndex, replaceQueueSlot } from '@/server/daily/catchup';
import { generateBreadcrumb } from '@/server/daily/generate-breadcrumb';
import { type QueueSlot } from '@/server/daily/types';
import { dailyQueues, db } from '@/server/db';
import { getReplayWrongQuestions } from '@/server/db/queries/replay';
import { gradeAnswer } from '@/server/grading';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';

export const dynamic = 'force-dynamic';

function parseBody(value: unknown): { dailyQueueItemId: string; submittedAnswer: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const dailyQueueItemId = typeof record.dailyQueueItemId === 'string'
    ? record.dailyQueueItemId
    : typeof record.assignmentId === 'string'
      ? record.assignmentId
      : null;
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

  const replayItem = (await getReplayWrongQuestions(session.userId))
    .find((item) => item.dailyQueueItemId === parsed.dailyQueueItemId);
  if (!replayItem) return NextResponse.json({ error: 'not_found', message: 'Replay question not found' }, { status: 404 });

  const [queueId, slotIndexValue] = replayItem.dailyQueueItemId.split(':');
  const slotIndex = Number(slotIndexValue);
  const [queue] = await db
    .select()
    .from(dailyQueues)
    .where(eq(dailyQueues.id, queueId))
    .limit(1);
  if (!queue || queue.userId !== session.userId || !Number.isInteger(slotIndex)) {
    return NextResponse.json({ error: 'not_found', message: 'Replay question not found' }, { status: 404 });
  }

  const slots = asQueueSlots(queue.slots);
  const slot = findQueueSlotBySlotIndex(slots, slotIndex);
  if (!slot || !slot.answered || slot.answer_state !== 'incorrect') {
    return NextResponse.json({ error: 'invalid_state', message: 'Replay item is no longer available' }, { status: 400 });
  }

  const grade = await gradeAnswer(
    parsed.submittedAnswer,
    replayItem.correctAnswer,
    [],
    replayItem.questionText,
    'factual',
  );
  const isCorrect = grade.result === 'correct';
  const breadcrumb = await generateBreadcrumb({
    questionId: replayItem.questionId,
    questionText: replayItem.questionText,
    correctAnswer: replayItem.correctAnswer,
    submittedAnswer: parsed.submittedAnswer,
    isCorrect,
    domain: replayItem.domain,
  }).catch(() => null);

  const nextSlots = replaceQueueSlot(slots, slotIndex, (item) => ({
    ...item,
    answer_state: isCorrect ? 'correct' : 'incorrect',
    submitted_answer: parsed.submittedAnswer,
    reveal_canonical_answer: replayItem.correctAnswer,
    reveal_explainer: replayItem.explanation ?? '',
    reveal_breadcrumb: breadcrumb,
    reveal_quip: grade.consolation,
  }) satisfies QueueSlot);

  if (isCorrect) {
    await writeMasteryEvent({
      userId: session.userId,
      questionId: replayItem.questionId,
      domain: replayItem.domain,
      answerState: 'first_correct_after_wrong',
      pointsAwarded: 0,
      sourceType: 'catchup',
      sourceId: `replay:${replayItem.dailyQueueItemId}`,
      broadCategory: null,
      eventQuestionId: null,
      basePoints: 0,
      weight: 0,
    });
  }

  await db
    .update(dailyQueues)
    .set({ slots: nextSlots })
    .where(eq(dailyQueues.id, queue.id));

  return NextResponse.json({
    dailyQueueItemId: replayItem.dailyQueueItemId,
    result: grade.result,
    isCorrect,
    correct: isCorrect,
    pointsAwarded: 0,
    correctAnswer: replayItem.correctAnswer,
    explanation: replayItem.explanation,
    consolation: grade.consolation,
    breadcrumb,
    answerState: isCorrect ? 'first_correct_after_wrong' : 'incorrect',
  });
}
