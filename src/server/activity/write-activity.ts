import { activityItems, db } from '@/server/db';

export type ActivityItemType =
  | 'received_joshing_game'
  | 'joshing_game_result'
  | 'joshing_game_progress'
  | 'friend_mastery'
  | 'ceremony_ready'
  // Legacy friend-request types — no longer written (the follow model below
  // supersedes them) but retained so historical activity rows still type-check
  // and render against the frozen Friendship table.
  | 'friend_request'
  | 'friend_request_accepted'
  // D-1 Stage 3 follow model. `follow` = someone followed you (public account,
  // auto-approved). `follow_request` = someone requested to follow you
  // (approval_required). `follow_approved` = you approved their request.
  | 'follow'
  | 'follow_request'
  | 'follow_approved'
  // An invited friend both accepted the inviter's invitation and got far
  // enough into the product to play their first five questions. Surfaced to
  // the inviter as a "your invite stuck" milestone. Written from
  // write-mastery-event.ts once the invitee crosses the fifth play.
  | 'invited_friend_played_first_five'
  | 'received_direct_question'
  | 'reaction_received'
  | 'question_curated'
  | 'friend_answered_your_question'
  | 'authored_question_shared'
  | 'declared_promoted'
  // §8.22 grade-dispute path: the question's author is notified when an
  // answerer disputes their wrong-answer grade. The dispute is the
  // answerer's explicit ask for a second look, which is the consent gate
  // that exposes their submitted text to the author.
  | 'grade_dispute_filed'
  // D-2 niche-match discovery (slow-burn organic discovery between strangers
  // through a shared authored question). Two asymmetric writes from
  // notifyNicheMatch() in src/server/feed/create-feed-items-for-answer.ts,
  // each gated by the *exposed* party's discoverableByNicheMatch flag.
  // Deliberately NOT the same as friend_answered_your_question (which targets
  // prior answerers, is friend-scoped, and carries a got-it/couldn't-get-it
  // framing). Kept OUT of HOME_TOP3_ELIGIBLE_TYPES and the bell badge below —
  // this is a slow-burn delight with no volume cues; it surfaces only in the
  // full /activities list.
  | 'niche_match_answered_your_question' // author-side: a stranger correctly answered a question you authored
  | 'niche_match_you_answered'; // answerer-side: you correctly answered a stranger's authored question

// Events surfaced in Home's top-3 RecentActivity and counted by the bell
// badge. Light type filtering only — chronological within this set. Single
// source of truth for "is this event home-worthy?" — see RecentActivitySection
// and getBellBadgeCount.
export const HOME_TOP3_ELIGIBLE_TYPES = [
  'friend_answered_your_question',
  'friend_mastery',
  'declared_promoted',
  'reaction_received',
  'question_curated',
  'authored_question_shared',
] as const satisfies readonly ActivityItemType[];

export type HomeTop3EligibleType = (typeof HOME_TOP3_ELIGIBLE_TYPES)[number];

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
