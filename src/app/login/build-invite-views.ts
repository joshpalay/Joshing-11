/**
 * Pure data-shaping for LoginPanel's two invite props, pulled out of
 * src/app/login/page.tsx (Stage 5 of the invite-link build) so this logic is
 * directly testable without mocking getSession/getInvitePrefillByToken/
 * resolveInviteLink or rendering the page. Deliberately DB-free — the inputs
 * are the already-resolved query results, not the queries themselves.
 */

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
  topics?: string[];
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
 * builds inviteContext with its seedTopics (Stage 2); the named path never
 * carries topics here — it has its own separate pre-seeded-interests flow
 * inside onboarding.
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
          inviterName:
            userInviteResolution.inviterDisplayName?.trim() ||
            `@${userInviteResolution.inviterHandle}`,
          inviterUserId: userInviteResolution.inviterUserId,
          inviterAvatarColor: userInviteResolution.inviterAvatarColor,
          topics: userInviteResolution.seedTopics,
        }
      : null;

  return { invitePrefill, inviteContext };
}
