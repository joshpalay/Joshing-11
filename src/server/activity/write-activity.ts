import { and, eq, inArray, isNull } from 'drizzle-orm';

import { activityItems, db, users } from '@/server/db';
import { HOME_TOP3_ELIGIBLE_TYPES, type ActivityItemType } from '@/lib/activity-types';

// The activity-type vocabulary and the home-eligible set live in the DB-free
// `@/lib/activity-types` module so the client-shared activity-stream transform
// can read them without pulling this file's `pg` import into the browser
// bundle. Re-exported here so existing server-side importers of
// '@/server/activity/write-activity' keep working unchanged.
export { HOME_TOP3_ELIGIBLE_TYPES };
export type { ActivityItemType, HomeTop3EligibleType } from '@/lib/activity-types';

export async function writeActivity(params: {
  userId: string;
  type: ActivityItemType;
  actorUserId?: string;
  referenceId?: string;
  referenceType?: string;
}): Promise<void> {
  try {
    // Snapshot the actor's current display name into the row. actorUserId is
    // SET NULL when that account is deleted (schema.ts), which would
    // otherwise leave the row with no way to say who did this — the feed
    // falls back to the generic "Someone" copy. Best-effort: a lookup miss
    // just leaves the snapshot null, same as before this existed.
    let actorNameSnapshot: string | null = null;
    if (params.actorUserId) {
      const [actor] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, params.actorUserId))
        .limit(1);
      actorNameSnapshot = actor?.displayName?.trim() || null;
    }

    await db.insert(activityItems).values({
      userId: params.userId,
      type: params.type,
      actorUserId: params.actorUserId,
      actorNameSnapshot,
      referenceId: params.referenceId,
      referenceType: params.referenceType,
      read: false,
    });
  } catch (error) {
    console.error('Activity write failed', error);
  }
}

/**
 * Soft-delete the activity rows pointing at a given reference (e.g. the
 * follow_request row for a now-deleted pending follow edge). Used by the
 * decline/cancel paths so a resolved request stops rendering "{actor} wants to
 * be friends" once its backing edge is gone. Best-effort and never throws —
 * mirrors writeActivity, so it can't break the friendship write it follows.
 */
export async function softDeleteActivityByReference(params: {
  referenceType: string;
  referenceId: string;
  types: readonly ActivityItemType[];
  now?: Date;
}): Promise<void> {
  if (params.types.length === 0) return;
  try {
    await db
      .update(activityItems)
      .set({ deletedAt: params.now ?? new Date() })
      .where(
        and(
          eq(activityItems.referenceType, params.referenceType),
          eq(activityItems.referenceId, params.referenceId),
          inArray(activityItems.type, params.types as readonly string[]),
          isNull(activityItems.deletedAt),
        ),
      );
  } catch (error) {
    console.error('Activity soft-delete failed', error);
  }
}
