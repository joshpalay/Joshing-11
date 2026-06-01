import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { dailyQueues, db, skippedDailyQuestions } from '@/server/db';
import { DAILY_QUEUE_SIZE, DAILY_SKIP_LIMIT, type QueueSlot } from '@/server/daily/types';
import { generateDailyQuestionsFromKnowledgeBase } from '@/server/daily/generate-questions';
import { createDailyQueueItem } from '@/server/db/queries/daily';

export const dynamic = 'force-dynamic';

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

function parseBody(value: unknown): { queueId: string; slotIndex: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const queueId = typeof record.queue_id === 'string' ? record.queue_id : null;
  const slotIndex =
    typeof record.slot_index === 'number' && Number.isInteger(record.slot_index)
      ? record.slot_index
      : null;
  return queueId && slotIndex !== null ? { queueId, slotIndex } : null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json(
      { error: 'validation', message: 'queue_id and slot_index are required' },
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
  const slot = slots.find((item) => item.slot_index === parsed.slotIndex);
  if (!slot) {
    return NextResponse.json(
      { error: 'validation', message: 'slot_index out of range' },
      { status: 400 },
    );
  }
  if (slot.answered || slot.skipped) {
    return NextResponse.json(
      { error: 'invalid_state', message: 'slot is already closed' },
      { status: 400 },
    );
  }

  const currentSkipCount = slots.filter((item) => item.skipped).length;
  if (currentSkipCount >= DAILY_SKIP_LIMIT) {
    return NextResponse.json(
      { error: 'skip_limit_reached', skip_count: currentSkipCount, skip_limit: DAILY_SKIP_LIMIT },
      { status: 400 },
    );
  }

  const nextSlots = slots.map((item) =>
    item.slot_index === parsed.slotIndex ? ({ ...item, skipped: true } satisfies QueueSlot) : item,
  );

  await db.transaction(async (tx) => {
    await tx.insert(skippedDailyQuestions).values({
      userId: session.userId,
      queueId: queue.id,
      questionId: null,
      generatedQuestionId: slot.generated_question_id ?? null,
      canonicalSubcategory: slot.domain,
      skippedAt: new Date(),
    });

    await tx.update(dailyQueues).set({ slots: nextSlots }).where(eq(dailyQueues.id, queue.id));
  });

  const answeredCount = nextSlots.filter((item) => item.answered).length;
  const pendingCount = nextSlots.filter((item) => !item.answered && !item.skipped).length;
  const needsReplacement = answeredCount + pendingCount < DAILY_QUEUE_SIZE;

  let finalSlots: QueueSlot[] = nextSlots;
  let replacementAdded = false;

  if (needsReplacement) {
    try {
      const [generated] = await generateDailyQuestionsFromKnowledgeBase(session.userId, 1);
      if (generated) {
        const maxSlotIndex = nextSlots.reduce(
          (max, item) => (item.slot_index > max ? item.slot_index : max),
          -1,
        );
        const updatedQueue = await createDailyQueueItem(
          session.userId,
          generated.id,
          maxSlotIndex + 1,
        );
        finalSlots = Array.isArray(updatedQueue.slots)
          ? (updatedQueue.slots as QueueSlot[])
          : nextSlots;
        replacementAdded = true;
      }
    } catch (error) {
      console.error('[daily/skip] replacement generation failed', error);
    }
  }

  return NextResponse.json({
    skipped: true,
    skip_count: currentSkipCount + 1,
    skip_limit: DAILY_SKIP_LIMIT,
    replacement_added: replacementAdded,
    queue_id: queue.id,
    queue_date: queue.queueDate,
    slots: finalSlots,
  });
}
