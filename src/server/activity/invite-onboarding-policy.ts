import type { ActivityItemType } from './write-activity';

// The surfaces a newly invited friend actually plays through. MASTERY_EVENTS
// rows from these two session contexts count toward the first-five milestone;
// author/curator credit and feed writes do not. Kept here (free of any DB
// imports) so the smoke test can exercise the policy without a Postgres
// connection.
export const FIRST_FIVE_PLAY_SURFACES = ['daily', 'joshing_game'] as const;

// How many questions an invited friend must play before the inviter is
// notified.
export const FIRST_FIVE_THRESHOLD = 5;

export const INVITED_FRIEND_FIRST_FIVE_TYPE =
  'invited_friend_played_first_five' satisfies ActivityItemType;

export type FirstFiveActivity = {
  userId: string;
  type: typeof INVITED_FRIEND_FIRST_FIVE_TYPE;
  actorUserId: string;
  referenceId: string;
  // 'friend_invitation' for the named path (referenceId -> FriendInvitation.id);
  // 'follow' for a link-arrived user, who has no FriendInvitation row — there
  // referenceId points at the Follow edge left by acceptUserInviteLink instead.
  // Nothing dereferences this activity type's referenceId against either table
  // for rendering (see src/lib/activity-stream.ts), so this is a dedup key, not
  // a strict FK typing.
  referenceType: 'friend_invitation' | 'follow';
};

/**
 * Pure decision for the invited-friend first-five milestone: given how many
 * questions the friend has played, the invitation they joined via (if any), and
 * whether the inviter was already notified, return the activity to write — or
 * null to write nothing.
 *
 * Fires only on the exact crossing of the threshold so the inviter is notified
 * once, not on every subsequent answer.
 */
export function firstFiveActivityToWrite(params: {
  inviteeUserId: string;
  playedCount: number;
  invitation: {
    id: string;
    inviterUserId: string;
    referenceType: 'friend_invitation' | 'follow';
  } | null;
  alreadyNotified: boolean;
}): FirstFiveActivity | null {
  if (params.playedCount !== FIRST_FIVE_THRESHOLD) return null;
  if (!params.invitation?.inviterUserId) return null;
  if (params.alreadyNotified) return null;

  return {
    userId: params.invitation.inviterUserId,
    type: INVITED_FRIEND_FIRST_FIVE_TYPE,
    actorUserId: params.inviteeUserId,
    referenceId: params.invitation.id,
    referenceType: params.invitation.referenceType,
  };
}
