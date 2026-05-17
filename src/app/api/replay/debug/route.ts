import { and, desc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { asQueueSlots, dailyQueueItemId } from '@/server/daily/catchup';
import { dailyQueues, db, generatedQuestions } from '@/server/db';

export const dynamic = 'force-dynamic';

export type ReplayDebugRow = {
  dailyQueueItemId: string;
  queueId: string;
  queueDate: string;
  slotIndex: number;
  source: string;
  domain: string;
  slotQuestionText: string;
  canonicalQuestionText: string | null;
  textMismatch: boolean;
  submittedAnswer: string | null;
  revealCanonicalAnswer: string | null;
  answered: boolean;
  answerState: string | null;
  awardedPoints: number | null;
  recheckStatus: string | null;
  recheckReason: string | null;
  skipped: boolean;
  dismissedAt: string | null;
  dismissedReason: string | null;
  generatedQuestionId: string | null;
  passesMissedFilter: boolean;
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const queues = await db
    .select()
    .from(dailyQueues)
    .where(eq(dailyQueues.userId, session.userId))
    .orderBy(desc(dailyQueues.queueDate));

  const candidates = queues.flatMap((queue) =>
    asQueueSlots(queue.slots)
      .filter((slot) => slot.answered && slot.answer_state === 'incorrect')
      .map((slot) => ({ queue, slot })),
  );

  const generatedIds = Array.from(
    new Set(
      candidates
        .map(({ slot }) => slot.generated_question_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const questions = generatedIds.length > 0
    ? await db
        .select()
        .from(generatedQuestions)
        .where(and(
          eq(generatedQuestions.userId, session.userId),
          inArray(generatedQuestions.id, generatedIds),
        ))
    : [];
  const questionById = new Map(questions.map((question) => [question.id, question]));

  const rows: ReplayDebugRow[] = candidates.map(({ queue, slot }) => {
    const canonical = slot.generated_question_id ? questionById.get(slot.generated_question_id) ?? null : null;
    const slotQuestionText = slot.question_text ?? '';
    const canonicalQuestionText = canonical?.questionText ?? null;
    const passesMissedFilter =
      slot.answered === true
      && slot.answer_state === 'incorrect'
      && Boolean(slot.generated_question_id);

    return {
      dailyQueueItemId: dailyQueueItemId(queue.id, slot.slot_index),
      queueId: queue.id,
      queueDate: String(queue.queueDate),
      slotIndex: slot.slot_index,
      source: slot.source,
      domain: slot.domain,
      slotQuestionText,
      canonicalQuestionText,
      textMismatch: Boolean(canonicalQuestionText) && canonicalQuestionText !== slotQuestionText,
      submittedAnswer: slot.submitted_answer ?? null,
      revealCanonicalAnswer: slot.reveal_canonical_answer ?? null,
      answered: slot.answered,
      answerState: slot.answer_state ?? null,
      awardedPoints: typeof slot.awarded_points === 'number' ? slot.awarded_points : null,
      recheckStatus: slot.recheck_status ?? null,
      recheckReason: slot.recheck_reason ?? null,
      skipped: Boolean(slot.skipped),
      dismissedAt: slot.dismissed_at ?? null,
      dismissedReason: slot.dismissed_reason ?? null,
      generatedQuestionId: slot.generated_question_id ?? null,
      passesMissedFilter,
    };
  });

  return NextResponse.json({
    userId: session.userId,
    total: rows.length,
    rows,
  });
}
