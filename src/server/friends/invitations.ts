import { randomBytes } from 'crypto'

import { and, desc, eq, gt, isNull, or } from 'drizzle-orm'

import { db, friendInvitations } from '@/server/db'
import { upsertInvitationFriendship } from '@/server/friends/friendships'

export const INVITATION_ACCEPTANCE_ERROR_MESSAGE =
  'This invitation could not be accepted.'

const DEFAULT_INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 14

export type FriendInvitation = typeof friendInvitations.$inferSelect

export type CreateFriendInvitationInput = {
  inviterUserId: string
  inviteePhone: string
  inviteeDisplayName: string
  preSeededInterests?: unknown
  personalMessage?: string | null
  now?: Date
  expiresAt?: Date
}

export type AcceptFriendInvitationResult =
  | { accepted: true }
  | {
      accepted: false
      reason:
        | 'missing'
        | 'expired'
        | 'accepted'
        | 'cancelled'
        | 'self'
        | 'phone_mismatch'
        | 'claim_failed'
    }

function normalizeRequiredText(value: string, fieldName: string) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    throw new Error(`${fieldName} is required`)
  }
  return normalized
}

function generateInvitationToken() {
  return randomBytes(32).toString('base64url')
}

export async function createFriendInvitation({
  inviterUserId,
  inviteePhone,
  inviteeDisplayName,
  preSeededInterests = null,
  personalMessage = null,
  now = new Date(),
  expiresAt = new Date(now.getTime() + DEFAULT_INVITATION_TTL_MS),
}: CreateFriendInvitationInput): Promise<FriendInvitation> {
  const normalizedInviteePhone = normalizeRequiredText(
    inviteePhone,
    'inviteePhone'
  )
  const normalizedInviteeDisplayName = normalizeRequiredText(
    inviteeDisplayName,
    'inviteeDisplayName'
  )

  const existingInvitation = await getPendingInvitationForPhone({
    inviterUserId,
    inviteePhone: normalizedInviteePhone,
    now,
  })

  if (existingInvitation) {
    const [updatedInvitation] = await db
      .update(friendInvitations)
      .set({
        inviteeDisplayName: normalizedInviteeDisplayName,
        preSeededInterests,
        personalMessage,
        expiresAt,
      })
      .where(
        and(
          eq(friendInvitations.id, existingInvitation.id),
          isNull(friendInvitations.acceptedAt),
          isNull(friendInvitations.cancelledAt),
          gt(friendInvitations.expiresAt, now)
        )
      )
      .returning()

    if (updatedInvitation) return updatedInvitation
  }

  const [createdInvitation] = await db
    .insert(friendInvitations)
    .values({
      inviterUserId,
      inviteePhone: normalizedInviteePhone,
      inviteeDisplayName: normalizedInviteeDisplayName,
      preSeededInterests,
      personalMessage,
      token: generateInvitationToken(),
      sentAt: now,
      expiresAt,
    })
    .returning()

  if (!createdInvitation) {
    throw new Error('Friend invitation could not be created')
  }

  return createdInvitation
}

export async function getInvitationByToken(
  token: string
): Promise<FriendInvitation | null> {
  if (!token) return null

  const [invitation] = await db
    .select()
    .from(friendInvitations)
    .where(eq(friendInvitations.token, token))
    .limit(1)

  return invitation ?? null
}

export async function getPendingInvitationForPhone({
  inviterUserId,
  inviteePhone,
  now = new Date(),
}: {
  inviterUserId: string
  inviteePhone: string
  now?: Date
}): Promise<FriendInvitation | null> {
  const [invitation] = await db
    .select()
    .from(friendInvitations)
    .where(
      and(
        eq(friendInvitations.inviterUserId, inviterUserId),
        eq(friendInvitations.inviteePhone, inviteePhone),
        isNull(friendInvitations.acceptedAt),
        isNull(friendInvitations.cancelledAt),
        gt(friendInvitations.expiresAt, now)
      )
    )
    .orderBy(desc(friendInvitations.sentAt))
    .limit(1)

  return invitation ?? null
}

export async function cancelFriendInvitation({
  invitationId,
  inviterUserId,
  now = new Date(),
}: {
  invitationId: string
  inviterUserId: string
  now?: Date
}): Promise<FriendInvitation | null> {
  const [invitation] = await db
    .update(friendInvitations)
    .set({ cancelledAt: now })
    .where(
      and(
        eq(friendInvitations.id, invitationId),
        eq(friendInvitations.inviterUserId, inviterUserId),
        isNull(friendInvitations.acceptedAt),
        isNull(friendInvitations.cancelledAt)
      )
    )
    .returning()

  return invitation ?? null
}

export async function markInvitationAccepted({
  invitationId,
  inviteeUserId,
  verifiedPhone,
  now = new Date(),
}: {
  invitationId: string
  inviteeUserId: string
  verifiedPhone: string
  now?: Date
}): Promise<FriendInvitation | null> {
  const [invitation] = await db
    .update(friendInvitations)
    .set({ acceptedAt: now, inviteeUserId })
    .where(
      and(
        eq(friendInvitations.id, invitationId),
        isNull(friendInvitations.acceptedAt),
        isNull(friendInvitations.cancelledAt),
        gt(friendInvitations.expiresAt, now),
        eq(friendInvitations.inviteePhone, verifiedPhone),
        or(
          eq(friendInvitations.inviteeUserId, inviteeUserId),
          isNull(friendInvitations.inviteeUserId)
        )
      )
    )
    .returning()

  return invitation ?? null
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
  const invitation = await getInvitationByToken(token)

  if (!invitation) {
    return { accepted: false, reason: 'missing' }
  }

  if (invitation.acceptedAt) {
    return { accepted: false, reason: 'accepted' }
  }

  if (invitation.cancelledAt) {
    return { accepted: false, reason: 'cancelled' }
  }

  if (invitation.expiresAt <= now) {
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
          isNull(friendInvitations.cancelledAt),
          gt(friendInvitations.expiresAt, now),
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
