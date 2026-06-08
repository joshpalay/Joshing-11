import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';

import { getSession } from '@/server/auth/session';
import { dailyQueues, db, feedItems } from '@/server/db';
import {
  asQueueSlots,
  findQueueSlotBySlotIndex,
  parseCatchupItemId,
  replaceQueueSlot,
} from '@/server/daily/catchup';
import { type QueueSlot } from '@/server/daily/types';
import { catchUpErrorResponse } from '@/server/play/catch-up-submit-error';

export const dynamic = 'force-dynamic';

function parseBody(value: unknown): { dailyQueueItemId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const dailyQueueItemId = (value as Record<string, unknown>).dailyQueueItemId;
  return typeof dailyQueueItemId === 'string' ? { dailyQueueItemId } : null;
}

// Reverses POST /api/daily/catchup/dismiss, restoring a question to catch-up
// rotation. The dismissed item is filtered out of getCatchupQuestions by the
// eligibility gates, so the target is resolved straight from the opaque id
// (`feed:<id>` or `<queueId>:<slotIndex>`) rather than that query.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return catchUpErrorResponse(401, 'unauthorized');

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return catchUpErrorResponse(400, 'validation', 'dailyQueueItemId is required');
  }

  const target = parseCatchupItemId(parsed.dailyQueueItemId);
  if (!target) {
    return catchUpErrorResponse(400, 'validation', 'dailyQueueItemId is malformed');
  }

  if (target.surface === 'feed') {
    const [feedItem] = await db
      .select()
      .from(feedItems)
      .where(eq(feedItems.id, target.feedItemId))
      .limit(1);
    if (!feedItem || feedItem.recipientUserId !== session.userId) {
      return catchUpErrorResponse(404, 'assignment_not_found', 'Catch-up question not found');
    }

    await db
      .update(feedItems)
      .set({ catchupResolvedAt: null })
      .where(eq(feedItems.id, feedItem.id));

    return Response.json({ restored: true });
  }

  const [queue] = await db
    .select()
    .from(dailyQueues)
    .where(eq(dailyQueues.id, target.queueId))
    .limit(1);
  if (!queue || queue.userId !== session.userId) {
    return catchUpErrorResponse(404, 'assignment_not_found', 'Catch-up question not found');
  }

  const slots = asQueueSlots(queue.slots);
  const slot = findQueueSlotBySlotIndex(slots, target.slotIndex);
  if (!slot) {
    return catchUpErrorResponse(404, 'assignment_not_found', 'Catch-up question not found');
  }

  const nextSlots = replaceQueueSlot(
    slots,
    target.slotIndex,
    (item) =>
      ({
        ...item,
        dismissed_at: undefined,
        dismissed_reason: undefined,
      }) satisfies QueueSlot,
  );

  await db.update(dailyQueues).set({ slots: nextSlots }).where(eq(dailyQueues.id, target.queueId));

  return Response.json({ restored: true });
}
