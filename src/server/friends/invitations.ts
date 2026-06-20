import { randomBytes } from 'crypto'

import { and, desc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm'

import { maskPhoneE164 } from '@/lib/phone-e164'
import { db, friendInvitations, users } from '@/server/db'
import { backfillInviterFeedItems } from '@/server/feed/backfill-inviter-feed'
import { upsertInvitationFriendship } from '@/server/friends/friendships'
import { hashTelemetryValue, logTelemetry } from '@/server/telemetry'

export const INVITATION_ACCEPTANCE_ERROR_MESSAGE =
  'This invitation could not be accepted.'

export const INVITE_REQUIRED_MESSAGE =
  "Joshing is invite-only. Ask a friend who's already on Joshing to send you an invite."

const DEFAULT_INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 14

export type FriendInvitation = typeof friendInvitations.$inferSelect

export type OutgoingFriendInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'expired'
  | 'cancelled'

export type OutgoingFriendInvitation = FriendInvitation & {
  status: OutgoingFriendInvitationStatus
  suggestedInterests: string[]
}

export type FriendInvitationLanding = {
  status: 'valid' | 'expired' | 'accepted' | 'invalid'
  inviterName: string
  inviterUserId: string | null
  inviterAvatarColor: string | null
}

export type InvitePrefill = {
  inviterName: string
  inviterUserId: string
  inviterAvatarColor: string | null
  // Recipient's E.164 phone resolved from the invite token. Default posture is
  // server-only (surface `maskedPhone` instead). Deliberate exception
  // (D-AUTH-INVITE-PHONE-FIRST §2.3): the phone-first FriendInvitation login
  // path pre-fills this full number into an editable field, so `login/page.tsx`
  // crosses it to the client — but ONLY for that invite-token-gated case. The
  // invitee's own number is not a secret from them. Do not widen this exposure.
  inviteePhone: string
  maskedPhone: string
}

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

function displayInviterName(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, ' ')
  return normalized ? normalized.slice(0, 80) : 'Someone'
}

export function parseInvitationInterests(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const interests: string[] = []

  for (const item of value) {
    const rawLabel =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>).label
          : null
    const label =
      typeof rawLabel === 'string' ? rawLabel.trim().replace(/\s+/g, ' ') : ''
    if (!label) continue

    const key = label.toLocaleLowerCase('en-US')
    if (seen.has(key)) continue

    seen.add(key)
    interests.push(label.slice(0, 80))
    if (interests.length === 3) break
  }

  return interests
}

export async function getFriendInvitationLandingByToken(
  token: string,
  now = new Date()
): Promise<FriendInvitationLanding> {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    return { status: 'invalid', inviterName: 'Someone', inviterUserId: null, inviterAvatarColor: null }
  }

  const [row] = await db
    .select({
      acceptedAt: friendInvitations.acceptedAt,
      cancelledAt: friendInvitations.cancelledAt,
      expiresAt: friendInvitations.expiresAt,
      preSeededInterests: friendInvitations.preSeededInterests,
      inviterName: users.displayName,
      inviterUserId: users.id,
      inviterAvatarColor: users.avatarColor,
    })
    .from(friendInvitations)
    .leftJoin(users, eq(friendInvitations.inviterUserId, users.id))
    .where(eq(friendInvitations.token, normalizedToken))
    .limit(1)

  if (!row || row.cancelledAt) {
    logTelemetry('friend_invite_link_opened', {
      status: 'invalid',
      invite_hash: hashTelemetryValue(normalizedToken),
    })
    return { status: 'invalid', inviterName: 'Someone', inviterUserId: null, inviterAvatarColor: null }
  }

  const inviterName = displayInviterName(row.inviterName)
  // Pre-seeded interests are NEVER returned to the public landing payload:
  // anyone with the link could otherwise view the inviter's notes for the
  // intended recipient. The labels are still surfaced to the recipient
  // post-OTP via getPreSeededInterestsForUser(). We count them here only
  // for telemetry.
  const interestCount = parseInvitationInterests(row.preSeededInterests).length

  if (row.acceptedAt) {
    logTelemetry('friend_invite_link_opened', {
      status: 'accepted',
      invite_hash: hashTelemetryValue(normalizedToken),
      suggested_interest_count: 0,
    })
    return {
      status: 'accepted',
      inviterName,
      inviterUserId: row.inviterUserId,
      inviterAvatarColor: row.inviterAvatarColor,
    }
  }

  if (row.expiresAt <= now) {
    logTelemetry('friend_invite_link_opened', {
      status: 'expired',
      invite_hash: hashTelemetryValue(normalizedToken),
      suggested_interest_count: 0,
    })
    return {
      status: 'expired',
      inviterName,
      inviterUserId: row.inviterUserId,
      inviterAvatarColor: row.inviterAvatarColor,
    }
  }

  logTelemetry('friend_invite_link_opened', {
    status: 'valid',
    invite_hash: hashTelemetryValue(normalizedToken),
    suggested_interest_count: interestCount,
  })

  return {
    status: 'valid',
    inviterName,
    inviterUserId: row.inviterUserId,
    inviterAvatarColor: row.inviterAvatarColor,
  }
}

/**
 * Resolve a valid, pending invite token to the data needed to prefill the
 * login screen with the recipient's phone — the inviter's name, the raw
 * recipient phone (server-only, for sending/verifying the OTP), and a masked
 * form safe to show the client. Returns null unless the invite is still
 * actionable (not accepted/cancelled/expired) and has a recipient phone, so
 * callers naturally fall back to manual phone entry.
 */
export async function getInvitePrefillByToken(
  token: string,
  now = new Date()
): Promise<InvitePrefill | null> {
  const normalizedToken = token.trim()
  if (!normalizedToken) return null

  const [row] = await db
    .select({
      acceptedAt: friendInvitations.acceptedAt,
      cancelledAt: friendInvitations.cancelledAt,
      expiresAt: friendInvitations.expiresAt,
      inviteePhone: friendInvitations.inviteePhone,
      inviterName: users.displayName,
      inviterUserId: users.id,
      inviterAvatarColor: users.avatarColor,
    })
    .from(friendInvitations)
    .leftJoin(users, eq(friendInvitations.inviterUserId, users.id))
    .where(eq(friendInvitations.token, normalizedToken))
    .limit(1)

  if (!row) return null
  if (row.acceptedAt || row.cancelledAt) return null
  if (row.expiresAt <= now) return null

  const inviteePhone = row.inviteePhone?.trim()
  if (!inviteePhone) return null

  return {
    inviterName: displayInviterName(row.inviterName),
    inviterUserId: row.inviterUserId ?? 'friend-invite',
    inviterAvatarColor: row.inviterAvatarColor,
    inviteePhone,
    maskedPhone: maskPhoneE164(inviteePhone),
  }
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

export async function hasAcceptedInvitationForUser(
  inviteeUserId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: friendInvitations.id })
    .from(friendInvitations)
    .where(
      and(
        eq(friendInvitations.inviteeUserId, inviteeUserId),
        isNotNull(friendInvitations.acceptedAt)
      )
    )
    .limit(1)

  return !!row
}

export async function hasValidPendingInvitationForPhone(
  phoneNumber: string,
  now: Date = new Date()
): Promise<boolean> {
  if (!phoneNumber) return false

  const [row] = await db
    .select({ id: friendInvitations.id })
    .from(friendInvitations)
    .where(
      and(
        eq(friendInvitations.inviteePhone, phoneNumber),
        isNull(friendInvitations.acceptedAt),
        isNull(friendInvitations.cancelledAt),
        gt(friendInvitations.expiresAt, now)
      )
    )
    .limit(1)

  return !!row
}

export async function getValidInvitationForPhone({
  token,
  verifiedPhone,
  now = new Date(),
}: {
  token: string
  verifiedPhone: string
  now?: Date
}): Promise<FriendInvitation | null> {
  if (!token || !verifiedPhone) return null

  const [invitation] = await db
    .select()
    .from(friendInvitations)
    .where(
      and(
        eq(friendInvitations.token, token),
        eq(friendInvitations.inviteePhone, verifiedPhone),
        isNull(friendInvitations.acceptedAt),
        isNull(friendInvitations.cancelledAt),
        gt(friendInvitations.expiresAt, now)
      )
    )
    .limit(1)

  return invitation ?? null
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

export function getOutgoingFriendInvitationStatus(
  invitation: Pick<
    FriendInvitation,
    'acceptedAt' | 'cancelledAt' | 'expiresAt'
  >,
  now = new Date()
): OutgoingFriendInvitationStatus {
  if (invitation.cancelledAt) return 'cancelled'
  if (invitation.acceptedAt) return 'accepted'
  if (invitation.expiresAt <= now) return 'expired'
  return 'pending'
}

export async function listOutgoingFriendInvitations({
  inviterUserId,
  now = new Date(),
}: {
  inviterUserId: string
  now?: Date
}): Promise<OutgoingFriendInvitation[]> {
  const invitations = await db
    .select()
    .from(friendInvitations)
    .where(eq(friendInvitations.inviterUserId, inviterUserId))
    .orderBy(desc(friendInvitations.sentAt))

  return invitations.map((invitation) => ({
    ...invitation,
    status: getOutgoingFriendInvitationStatus(invitation, now),
    suggestedInterests: parseInvitationInterests(invitation.preSeededInterests),
  }))
}

export type UpdateFriendInvitationInput = {
  invitationId: string
  inviterUserId: string
  inviteePhone: string
  inviteeDisplayName: string
  preSeededInterests?: unknown
  personalMessage?: string | null
  now?: Date
}

/**
 * Edit a still-pending outgoing invitation in place (B-Friends edit-before-click).
 * Only the inviter who created it may edit, and only while it is genuinely
 * pending — not accepted, not cancelled, not expired. The token (and therefore
 * the share link) is intentionally preserved so a link the inviter has already
 * copied but not yet sent stays valid; acceptance still gates on the (possibly
 * corrected) `inviteePhone`. Returns null when no row matched the pending guard.
 */
export async function updateFriendInvitation({
  invitationId,
  inviterUserId,
  inviteePhone,
  inviteeDisplayName,
  preSeededInterests = null,
  personalMessage = null,
  now = new Date(),
}: UpdateFriendInvitationInput): Promise<FriendInvitation | null> {
  const normalizedInviteePhone = normalizeRequiredText(
    inviteePhone,
    'inviteePhone'
  )
  const normalizedInviteeDisplayName = normalizeRequiredText(
    inviteeDisplayName,
    'inviteeDisplayName'
  )

  const [invitation] = await db
    .update(friendInvitations)
    .set({
      inviteePhone: normalizedInviteePhone,
      inviteeDisplayName: normalizedInviteeDisplayName,
      preSeededInterests,
      personalMessage,
    })
    .where(
      and(
        eq(friendInvitations.id, invitationId),
        eq(friendInvitations.inviterUserId, inviterUserId),
        isNull(friendInvitations.acceptedAt),
        isNull(friendInvitations.cancelledAt),
        gt(friendInvitations.expiresAt, now)
      )
    )
    .returning()

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
        isNull(friendInvitations.cancelledAt),
        gt(friendInvitations.expiresAt, now)
      )
    )
    .returning()

  return invitation ?? null
}

export async function deleteFriendInvitation({
  invitationId,
  inviterUserId,
}: {
  invitationId: string
  inviterUserId: string
}): Promise<FriendInvitation | null> {
  const [invitation] = await db
    .delete(friendInvitations)
    .where(
      and(
        eq(friendInvitations.id, invitationId),
        eq(friendInvitations.inviterUserId, inviterUserId),
        isNotNull(friendInvitations.cancelledAt)
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
    logTelemetry('friend_invite_phone_mismatch_rejected', {
      invitation_id: invitation.id,
      inviter_user_id: invitation.inviterUserId,
      invitee_user_id: inviteeUserId,
    })
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

  logTelemetry('friend_invite_accepted', {
    invitation_id: invitation.id,
    inviter_user_id: invitation.inviterUserId,
    invitee_user_id: inviteeUserId,
    suggested_interest_count: parseInvitationInterests(invitation.preSeededInterests).length,
  })

  // One-time inviter feed backfill (B-HomeSeed-1). Runs AFTER the acceptance tx
  // commits and only on a successful claim, so it fires exactly once per
  // invitation and never on subsequent logins. Best-effort internally — it
  // cannot throw, so it can't affect the accepted result.
  await backfillInviterFeedItems({
    inviterUserId: invitation.inviterUserId,
    inviteeUserId,
  })

  return { accepted: true }
}
