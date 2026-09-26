import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDailyAssignmentBounds } from '@/lib/games/timezone';
import { db, dailyQueues } from '@/server/db';

type Executor = Pick<typeof db, 'update'>;

/**
 * Remove today's UNANSWERED +2 bonus slots that came from `sourceUserId`'s
 * world. Call when the tie that sourced them ends — a block, an unfriend, or
 * the source deleting their account.
 *
 * A bonus slot is picked when the queue is built and was never re-checked, so
 * after a block (or with zero friends left) the round kept serving that
 * person's question under a "+2 friend bonus" label (QA 2026-09-25, S3).
 * scrubBlockedPresence only hid the name; this removes the question itself.
 * Answered slots stay: they're the record of what was played.
 *
 * `ownerIds` limits which players' queues are touched; omit it to clear the
 * source from every queue (account deletion). Removing a slot leaves a gap in
 * slot_index, which every reader tolerates (they sort; the skip append takes
 * max + 1).
 */
export async function dropSeveredBonusSlots(
  sourceUserId: string,
  ownerIds?: string[],
  executor: Executor = db,
): Promise<void> {
  if (ownerIds && ownerIds.length === 0) return;
  const { assignmentDateStr } = getDailyAssignmentBounds();

  await executor
    .update(dailyQueues)
    .set({
      slots: sql`(
        select coalesce(jsonb_agg(slot order by position), '[]'::jsonb)
        from jsonb_array_elements(${dailyQueues.slots}) with ordinality as t(slot, position)
        where not (
          slot->>'presence_source_id' = ${sourceUserId}
          and coalesce((slot->>'answered')::boolean, false) = false
        )
      )`,
    })
    .where(
      and(
        eq(dailyQueues.queueDate, assignmentDateStr),
        sql`${dailyQueues.slots} @> ${JSON.stringify([{ presence_source_id: sourceUserId }])}::jsonb`,
        ownerIds ? inArray(dailyQueues.userId, ownerIds) : undefined,
      ),
    );
}

/** Both directions: each person loses the other's unanswered bonus slots. */
export async function dropSeveredBonusSlotsBetween(userA: string, userB: string): Promise<void> {
  await Promise.all([dropSeveredBonusSlots(userA, [userB]), dropSeveredBonusSlots(userB, [userA])]);
}
