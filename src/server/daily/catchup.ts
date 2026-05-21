import { z } from 'zod';
import { type QueueSlot, queueSlotSchema } from '@/server/daily/types';

export const CATCHUP_LOOKBACK_DAYS = 7;

export function minusUtcDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function isCatchupQueueDate(
  queueDate: string,
  assignmentDate: string,
  lookbackDays = CATCHUP_LOOKBACK_DAYS,
): boolean {
  const oldestDate = minusUtcDays(assignmentDate, lookbackDays);
  return queueDate < assignmentDate && queueDate > oldestDate;
}

export function asQueueSlots(value: unknown): QueueSlot[] {
  if (!Array.isArray(value)) return [];
  const result = z.array(queueSlotSchema).safeParse(value);
  if (!result.success) {
    console.warn('[daily] QueueSlot JSONB failed schema validation', result.error.issues);
    return value as QueueSlot[];
  }
  return result.data;
}

export function dailyQueueItemId(queueId: string, slotIndex: number): string {
  return `${queueId}:${slotIndex}`;
}

// Catch-up now mixes daily-queue slots with feed items the user answered
// wrong. The wire field stays `dailyQueueItemId` (it's opaque to the client),
// but the value carries a prefix so the server can dispatch to the right
// surface. Daily IDs keep the original `${queueId}:${slotIndex}` shape for
// backward compatibility; feed IDs get a `feed:` prefix.
export const FEED_CATCHUP_ID_PREFIX = 'feed:';

export function feedCatchupItemId(feedItemId: string): string {
  return `${FEED_CATCHUP_ID_PREFIX}${feedItemId}`;
}

export function parseCatchupItemId(
  id: string,
): { surface: 'feed'; feedItemId: string } | { surface: 'daily'; queueId: string; slotIndex: number } | null {
  if (id.startsWith(FEED_CATCHUP_ID_PREFIX)) {
    const feedItemId = id.slice(FEED_CATCHUP_ID_PREFIX.length);
    return feedItemId ? { surface: 'feed', feedItemId } : null;
  }
  const [queueId, slotIndexValue] = id.split(':');
  const slotIndex = Number(slotIndexValue);
  if (!queueId || !Number.isInteger(slotIndex)) return null;
  return { surface: 'daily', queueId, slotIndex };
}

export function findQueueSlotBySlotIndex(slots: QueueSlot[], slotIndex: number): QueueSlot | null {
  return slots.find((slot) => slot.slot_index === slotIndex) ?? null;
}

export function replaceQueueSlot(
  slots: QueueSlot[],
  slotIndex: number,
  update: (slot: QueueSlot) => QueueSlot,
): QueueSlot[] {
  return slots.map((slot) => (slot.slot_index === slotIndex ? update(slot) : slot));
}
