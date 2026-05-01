import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { dailyQueues, db } from '@/server/db';
import { getCatchupQuestions } from '@/server/db/queries/daily';
import { asQueueSlots, findQueueSlotBySlotIndex, replaceQueueSlot } from '@/server/daily/catchup';
import { type QueueSlot } from '@/server/daily/types';

export const dynamic = 'force-dynamic';

function parseBody(value: unknown): { dailyQueueItemId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const dailyQueueItemId = (value as Record<string, unknown>).dailyQueueItemId;
  return typeof dailyQueueItemId === 'string' ? { dailyQueueItemId } : null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json(
      { error: 'validation', message: 'dailyQueueItemId is required' },
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

  const dismissedAt = new Date().toISOString();
  const nextSlots = replaceQueueSlot(
    slots,
    catchupItem.slotIndex,
    (item) => ({ ...item, dismissed_at: dismissedAt }) satisfies QueueSlot,
  );

  await db
    .update(dailyQueues)
    .set({ slots: nextSlots })
    .where(eq(dailyQueues.id, catchupItem.queueId));

  return NextResponse.json({ dismissed: true });
}
