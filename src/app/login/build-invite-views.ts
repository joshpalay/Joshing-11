/**
 * Pure data-shaping for LoginPanel's two invite props, pulled out of
 * src/app/login/page.tsx (Stage 5 of the invite-link build) so this logic is
 * directly testable without mocking getSession/getInvitePrefillByToken/
 * resolveInviteLink or rendering the page. Deliberately DB-free — the inputs
 * are the already-resolved query results, not the queries themselves.
 */

import { safeInviteName } from '@/lib/invite-links';

export type InvitePrefillView = {
  inviterName: string;
  inviterUserId: string;
  inviterAvatarColor: string | null;
  inviteePhone: string;
};

export type InviteContextView = {
  inviterName: string;
  inviterUserId: string;
  inviterAvatarColor: string | null;
};

type PrefillInput = {
  inviterName: string;
  inviterUserId: string;
  inviterAvatarColor: string | null;
  inviteePhone: string;
} | null;

type UserInviteResolutionInput = {
  inviterDisplayName: string | null;
  inviterHandle: string;
  inviterUserId: string;
  inviterAvatarColor: string | null;
  seedTopics: string[];
} | null;

/**
 * The named (FriendInvitation) prefill wins when present — it already knows
 * the invitee's phone number. Otherwise, a per-user invite-LINK resolution
 * builds inviteContext from the inviter's identity. Topic seeding still happens
 * after acceptance, but categories are intentionally not shown during login.
 */
export function buildLoginInviteViews(
  prefill: PrefillInput,
  userInviteResolution: UserInviteResolutionInput,
): { invitePrefill: InvitePrefillView | null; inviteContext: InviteContextView | null } {
  const invitePrefill: InvitePrefillView | null = prefill
    ? {
        inviterName: prefill.inviterName,
        inviterUserId: prefill.inviterUserId,
        inviterAvatarColor: prefill.inviterAvatarColor,
        // Full number (not masked): the phone-first field pre-fills it so the
        // invitee can confirm or correct it (D-AUTH-INVITE-PHONE-FIRST §2.3).
        inviteePhone: prefill.inviteePhone,
      }
    : null;

  const inviteContext: InviteContextView | null = prefill
    ? {
        inviterName: prefill.inviterName,
        inviterUserId: prefill.inviterUserId,
        inviterAvatarColor: prefill.inviterAvatarColor,
      }
    : userInviteResolution
      ? {
          inviterName: safeInviteName(userInviteResolution.inviterDisplayName) || 'A friend',
          inviterUserId: userInviteResolution.inviterUserId,
          inviterAvatarColor: userInviteResolution.inviterAvatarColor,
        }
      : null;

  return { invitePrefill, inviteContext };
}
