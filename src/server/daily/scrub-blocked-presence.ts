import { inArray } from 'drizzle-orm';

import { db, users } from '@/server/db';
import { blockedIdsAmong } from '@/server/db/queries/user-blocks';
import { isBonusSlot } from '@/server/daily/bonus';
import type { QueueSlot } from '@/server/daily/types';

/**
 * A +2 slot snapshots its "{Name}'s world" attribution when the queue is built.
 * If the viewer and that friend block each other afterwards, the stored name
 * would keep reaching the viewer (QA 2026-09-25, C2). Build-time sourcing
 * already excludes blocked people (getFollowing); this is the read-time half.
 *
 * The same goes for a friend who deletes their account: the snapshot outlives
 * the person, so the recap kept saying "from Quat's knowledge" after Quat was
 * gone (QA 2026-09-26, S14).
 *
 * Only the name is dropped: presence_source_id stays because it is the bonus
 * marker (isBonusSlot), and the slot still counts as a bonus.
 */
export async function scrubBlockedPresence(
  viewerId: string,
  slots: QueueSlot[],
): Promise<QueueSlot[]> {
  const sourceIds = [
    ...new Set(slots.filter(isBonusSlot).map((slot) => slot.presence_source_id as string)),
  ];
  if (sourceIds.length === 0) return slots;

  const [blocked, existingRows] = await Promise.all([
    blockedIdsAmong(viewerId, sourceIds),
    db.select({ id: users.id }).from(users).where(inArray(users.id, sourceIds)),
  ]);
  const existing = new Set(existingRows.map((row) => row.id));
  const hidden = new Set(sourceIds.filter((id) => blocked.has(id) || !existing.has(id)));
  if (hidden.size === 0) return slots;

  return slots.map((slot) =>
    isBonusSlot(slot) && hidden.has(slot.presence_source_id as string)
      ? { ...slot, presence_source_name: null, presence_source_extra_count: 0 }
      : slot,
  );
}
