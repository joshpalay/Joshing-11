import { randomBytes } from 'node:crypto'

import { and, count, eq, isNull } from 'drizzle-orm'

import { db, userInviteLinks, users } from '@/server/db'

// B-FRIENDS-INVITE-LINKS-01 — up to 3 named links per user, replacing the
// single evergreen users.invite_token. See the comment on userInviteLinks in
// schema.ts for the slot model (0 = untagged, 1-3 = a specific standing
// topic slot).
export const MAX_LIVE_INVITE_LINKS = 3

// Same primitive as the pre-existing FriendInvitation tokens
// (src/server/friends/invitations.ts) and the single-token model this
// replaces: randomBytes(32).toString('base64url') yields a 43-char
// URL-safe string.
export function generateUserInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

export type InviteLinkRow = {
  id: string
  token: string
  slot: number
  createdAt: Date
  joinedCount: number
}

// Live (non-deleted) links for a user, oldest first — slot 0 (untagged) may
// repeat; slots 1-3 cannot, enforced by UserInviteLink_user_id_slot_live_key.
export async function listLiveInviteLinks(userId: string): Promise<InviteLinkRow[]> {
  return db
    .select({
      id: userInviteLinks.id,
      token: userInviteLinks.token,
      slot: userInviteLinks.slot,
      createdAt: userInviteLinks.createdAt,
      joinedCount: count(users.id),
    })
    .from(userInviteLinks)
    .leftJoin(users, eq(users.joinedViaInviteLinkId, userInviteLinks.id))
    .where(and(eq(userInviteLinks.userId, userId), isNull(userInviteLinks.deletedAt)))
    .groupBy(userInviteLinks.id)
    .orderBy(userInviteLinks.createdAt)
}

export type CreateInviteLinkResult =
  | { ok: true; link: InviteLinkRow }
  | { ok: false; error: 'limit_reached' | 'slot_taken' | 'invalid_slot' }

// Creates a new live link in `slot` (0 = untagged, 1-3 = a standing topic
// slot). Rejects at MAX_LIVE_INVITE_LINKS live links, and — for a named slot
// — at one live link per slot (UserInviteLink_user_id_slot_live_key catches
// the race; the pre-check here is just the fast, friendly path).
export async function createInviteLink(userId: string, slot: number): Promise<CreateInviteLinkResult> {
  if (!Number.isInteger(slot) || slot < 0 || slot > 3) return { ok: false, error: 'invalid_slot' }

  const live = await listLiveInviteLinks(userId)
  if (live.length >= MAX_LIVE_INVITE_LINKS) return { ok: false, error: 'limit_reached' }
  if (slot !== 0 && live.some((link) => link.slot === slot)) return { ok: false, error: 'slot_taken' }

  const token = generateUserInviteToken()
  try {
    const [row] = await db
      .insert(userInviteLinks)
      .values({ userId, token, slot })
      .returning({
        id: userInviteLinks.id,
        token: userInviteLinks.token,
        slot: userInviteLinks.slot,
        createdAt: userInviteLinks.createdAt,
      })

    if (!row) return { ok: false, error: 'limit_reached' }
    return { ok: true, link: { ...row, joinedCount: 0 } }
  } catch {
    // Unique-violation race on the partial (user_id, slot) index — someone
    // created a link in this slot between the pre-check above and the insert.
    return { ok: false, error: 'slot_taken' }
  }
}

// Soft-deletes a live link the caller owns. No-op (returns false) if the link
// doesn't exist, isn't theirs, or is already deleted — callers treat false as
// "nothing to do" rather than an error, since a double-delete from a slow
// network retry shouldn't surface as a failure.
export async function softDeleteInviteLink(userId: string, linkId: string): Promise<boolean> {
  const result = await db
    .update(userInviteLinks)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(userInviteLinks.id, linkId),
        eq(userInviteLinks.userId, userId),
        isNull(userInviteLinks.deletedAt),
      ),
    )
    .returning({ id: userInviteLinks.id })

  return result.length > 0
}

export type LiveInviteLinkLookup = {
  id: string
  userId: string
  slot: number
}

// The /u/<handle>/<token> and accept-time resolution primitive: the specific
// LIVE link for this user+token pair, or null if it doesn't exist, belongs to
// someone else, or was deleted. Handle is matched by the caller (via a lookup
// on users.handle) before this is reached; the userId here is the
// authoritative check paired with the token.
export async function findLiveInviteLinkByToken(
  userId: string,
  token: string,
): Promise<LiveInviteLinkLookup | null> {
  const [row] = await db
    .select({ id: userInviteLinks.id, userId: userInviteLinks.userId, slot: userInviteLinks.slot })
    .from(userInviteLinks)
    .where(
      and(
        eq(userInviteLinks.userId, userId),
        eq(userInviteLinks.token, token),
        isNull(userInviteLinks.deletedAt),
      ),
    )
    .limit(1)

  return row ?? null
}

// Records which link an invitee joined through. Called once, at accept time
// (acceptUserInviteLink) — never overwritten afterward, so it survives the
// link being later deleted (the row stays; only deletedAt is set) and stays
// meaningful even if the inviter's topics change under the slot later.
export async function attributeInviteLinkJoin(inviteeUserId: string, linkId: string): Promise<void> {
  await db.update(users).set({ joinedViaInviteLinkId: linkId }).where(eq(users.id, inviteeUserId))
}

export type JoinedLinkInfo = {
  inviterUserId: string
  slot: number
}

// The link a user joined through, if any and if attributed. NULL for anyone
// who joined before this table existed, joined via the named FriendInvitation
// path, or (rarely) formed a mutual follow within the getInviterForUser
// fallback window without going through a link at all — callers fall back to
// the unslotted "all curated/declared topics" resolution in that case.
export async function getJoinedInviteLink(inviteeUserId: string): Promise<JoinedLinkInfo | null> {
  const [row] = await db
    .select({ userId: userInviteLinks.userId, slot: userInviteLinks.slot })
    .from(users)
    .innerJoin(userInviteLinks, eq(userInviteLinks.id, users.joinedViaInviteLinkId))
    .where(eq(users.id, inviteeUserId))
    .limit(1)

  return row ? { inviterUserId: row.userId, slot: row.slot } : null
}
