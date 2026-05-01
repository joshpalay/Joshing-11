import { activityItems, db } from '@/server/db';

export type ActivityItemType =
  | 'received_joshing_game'
  | 'joshing_game_result'
  | 'joshing_game_progress'
  | 'friend_mastery'
  | 'ceremony_ready'
  | 'friend_request'
  | 'friend_request_accepted';

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
