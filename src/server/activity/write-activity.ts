import { activityItems, db } from '@/server/db';
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
    await db.insert(activityItems).values({
      userId: params.userId,
      type: params.type,
      actorUserId: params.actorUserId,
      referenceId: params.referenceId,
      referenceType: params.referenceType,
      read: false,
    });
  } catch (error) {
    console.error('Activity write failed', error);
  }
}
