import { and, eq, isNull, or } from 'drizzle-orm'

import { db, friendInvitations } from '@/server/db'
import { upsertInvitationFriendship } from '@/server/friends/friendships'

export const INVITATION_ACCEPTANCE_ERROR_MESSAGE =
  'This invitation could not be accepted.'

export type AcceptFriendInvitationResult =
  | { accepted: true }
  | {
      accepted: false
      reason:
        | 'missing'
        | 'expired'
        | 'accepted'
        | 'self'
        | 'phone_mismatch'
        | 'claim_failed'
    }

export async function acceptFriendInvitation({
  token,
  inviteeUserId,
  verifiedPhone,
  now = new Date(),
}: {
  token: string
  inviteeUserId: string
  verifiedPhone: string
  now?: Date
}): Promise<AcceptFriendInvitationResult> {
  if (!token) {
    return { accepted: false, reason: 'missing' }
  }

  const [invitation] = await db
    .select()
    .from(friendInvitations)
    .where(eq(friendInvitations.token, token))
    .limit(1)

  if (!invitation) {
    return { accepted: false, reason: 'missing' }
  }

  if (invitation.acceptedAt) {
    return { accepted: false, reason: 'accepted' }
  }

  if (invitation.expiresAt < now) {
    return { accepted: false, reason: 'expired' }
  }

  if (invitation.inviterUserId === inviteeUserId) {
    return { accepted: false, reason: 'self' }
  }

  if (invitation.inviteePhone !== verifiedPhone) {
    return { accepted: false, reason: 'phone_mismatch' }
  }

  const [claimedInvitation] = await db.transaction(async (tx) => {
    const [updatedInvitation] = await tx
      .update(friendInvitations)
      .set({ acceptedAt: now, inviteeUserId })
      .where(
        and(
          eq(friendInvitations.id, invitation.id),
          isNull(friendInvitations.acceptedAt),
          eq(friendInvitations.inviteePhone, verifiedPhone),
          or(
            eq(friendInvitations.inviteeUserId, inviteeUserId),
            isNull(friendInvitations.inviteeUserId)
          )
        )
      )
      .returning({ id: friendInvitations.id })

    if (!updatedInvitation) return []

    await upsertInvitationFriendship(tx, {
      inviterUserId: invitation.inviterUserId,
      inviteeUserId,
      formedAt: now,
    })

    return [updatedInvitation]
  })

  if (!claimedInvitation) {
    return { accepted: false, reason: 'claim_failed' }
  }

  return { accepted: true }
}
