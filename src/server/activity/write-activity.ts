import { activityItems, db } from '@/server/db';

export type ActivityItemType =
  | 'received_joshing_game'
  | 'joshing_game_result'
  | 'joshing_game_progress'
  | 'friend_mastery'
  | 'ceremony_ready'
  | 'friend_request'
  | 'friend_request_accepted'
  | 'received_direct_question'
  | 'reaction_received'
  | 'question_curated'
  | 'creator_note_received'
  | 'friend_answered_your_question'
  | 'authored_question_shared'
  | 'declared_promoted'
  // §8.22 grade-dispute path: the question's author is notified when an
  // answerer disputes their wrong-answer grade. The dispute is the
  // answerer's explicit ask for a second look, which is the consent gate
  // that exposes their submitted text to the author.
  | 'grade_dispute_filed';

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
