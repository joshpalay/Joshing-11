import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';

import { getSession } from '@/server/auth/session';
import { dailyQueues, db, feedItems } from '@/server/db';
import { getCatchupQuestions } from '@/server/db/queries/daily';
import { asQueueSlots, findQueueSlotBySlotIndex, replaceQueueSlot } from '@/server/daily/catchup';
import { type QueueSlot } from '@/server/daily/types';
import { catchUpErrorResponse } from '@/server/play/catch-up-submit-error';

export const dynamic = 'force-dynamic';

type DismissReason = 'not_interested' | 'too_old' | 'unclear';

const DISMISS_REASONS = new Set<DismissReason>(['not_interested', 'too_old', 'unclear']);

function parseBody(value: unknown): { dailyQueueItemId: string; reason?: DismissReason } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const dailyQueueItemId = record.dailyQueueItemId;
  const reason = record.reason;
  return typeof dailyQueueItemId === 'string'
    ? {
        dailyQueueItemId,
        reason: typeof reason === 'string' && DISMISS_REASONS.has(reason as DismissReason)
          ? reason as DismissReason
          : undefined,
      }
    : null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return catchUpErrorResponse(401, 'unauthorized');

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return catchUpErrorResponse(400, 'validation', 'dailyQueueItemId is required');
  }

  const catchupItem = (await getCatchupQuestions(session.userId))
    .find((item) => item.dailyQueueItemId === parsed.dailyQueueItemId);
  if (!catchupItem) return catchUpErrorResponse(404, 'assignment_not_found', 'Catch-up question not found');

  if (catchupItem.surface === 'feed') {
    if (!catchupItem.feedItemId) {
      return catchUpErrorResponse(500, 'invalid_state', 'Feed catch-up item missing feed reference');
    }
    const [feedItem] = await db
      .select()
      .from(feedItems)
      .where(eq(feedItems.id, catchupItem.feedItemId))
      .limit(1);
    if (!feedItem || feedItem.recipientUserId !== session.userId) {
      return catchUpErrorResponse(404, 'assignment_not_found', 'Catch-up question not found');
    }
    if (feedItem.catchupResolvedAt) {
      return catchUpErrorResponse(400, 'invalid_state', 'catch-up item is already closed');
    }

    await db
      .update(feedItems)
      .set({ catchupResolvedAt: new Date() })
      .where(eq(feedItems.id, feedItem.id));

    return Response.json({ dismissed: true });
  }

  if (catchupItem.queueId === null || catchupItem.slotIndex === null) {
    return catchUpErrorResponse(500, 'invalid_state', 'Daily catch-up item missing queue reference');
  }

  const [queue] = await db
    .select()
    .from(dailyQueues)
    .where(eq(dailyQueues.id, catchupItem.queueId))
    .limit(1);
  if (!queue || queue.userId !== session.userId) {
    return catchUpErrorResponse(404, 'assignment_not_found', 'Catch-up question not found');
  }

  const slots = asQueueSlots(queue.slots);
  const slot = findQueueSlotBySlotIndex(slots, catchupItem.slotIndex);
  if (!slot || slot.dismissed_at) {
    return catchUpErrorResponse(400, 'invalid_state', 'catch-up item is already closed');
  }
  if (slot.answered && slot.answer_state !== 'incorrect') {
    return catchUpErrorResponse(400, 'invalid_state', 'catch-up item is already closed');
  }

  const dismissedAt = new Date().toISOString();
  const nextSlots = replaceQueueSlot(
    slots,
    catchupItem.slotIndex,
    (item) => ({
      ...item,
      dismissed_at: dismissedAt,
      dismissed_reason: parsed.reason,
    }) satisfies QueueSlot,
  );

  await db
    .update(dailyQueues)
    .set({ slots: nextSlots })
    .where(eq(dailyQueues.id, catchupItem.queueId));

  return Response.json({ dismissed: true });
}
