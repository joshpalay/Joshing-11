import { and, asc, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'

import { db, follows, friendInvitations, users } from '@/server/db'
import { getRelationships, type RelationshipResult } from '@/server/db/queries/friend-requests'

const FOLLOW_FALLBACK_WINDOW_DAYS = 7

export type InviterForUser = {
  inviterUserId: string
  inviterName: string | null
  // The row that proves the invitation, and its table — carried through so
  // callers that write an idempotency marker (e.g. maybeNotifyInviterOfFirstFive)
  // have a stable id even for a link-arrived user, who has no FriendInvitation
  // row at all.
  sourceId: string
  sourceType: 'friend_invitation' | 'follow'
}

/**
 * Resolves "who invited this user" across both arrival paths.
 *
 * (a) The named path (AddFriendInvite -> friendInvitations) always wins when
 *     present: it is explicit and permanent. Matches the most-recently-accepted
 *     row, same as the prior inline queries in get-first-session-recap.ts and
 *     invite-onboarding.ts.
 * (b) The per-user invite-link path (/u/<handle>/<token> -> acceptUserInviteLink)
 *     never writes a FriendInvitation row — it only leaves a mutual approved
 *     Follow edge (see src/server/friends/user-invite-token.ts). As a fallback,
 *     we look for the earliest approved follow-in edge within 7 days of the
 *     user's account creation.
 *
 *     The 7-day window matters: `follows` rows are HARD-DELETED on unfollow
 *     (every unfollow/remove path in src/server/friends/friendships.ts is a
 *     real DELETE, not a state change), so an unbounded "earliest surviving
 *     edge" query is not a stable signal — if the inviter and invitee ever
 *     unfollow each other, it would silently reassign to whichever unrelated
 *     follow happens to be earliest at query time. Bounding to the signup
 *     window (the mutual follow is written at accept time, at/near signup)
 *     means a deleted inviter-edge yields `null` (no-inviter treatment,
 *     matching what a named invite gets if its FriendInvitation row is
 *     hard-deleted) rather than a misattributed one.
 */
export async function getInviterForUser(userId: string): Promise<InviterForUser | null> {
  const [invitation] = await db
    .select({
      id: friendInvitations.id,
      inviterUserId: friendInvitations.inviterUserId,
      inviterName: users.displayName,
    })
    .from(friendInvitations)
    .leftJoin(users, eq(friendInvitations.inviterUserId, users.id))
    .where(
      and(eq(friendInvitations.inviteeUserId, userId), isNotNull(friendInvitations.acceptedAt)),
    )
    .orderBy(desc(friendInvitations.acceptedAt))
    .limit(1)

  if (invitation?.inviterUserId) {
    return {
      inviterUserId: invitation.inviterUserId,
      inviterName: invitation.inviterName,
      sourceId: invitation.id,
      sourceType: 'friend_invitation',
    }
  }

  const [target] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!target) return null

  const windowStart = new Date(
    target.createdAt.getTime() - FOLLOW_FALLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )

  const [follow] = await db
    .select({
      id: follows.id,
      inviterUserId: follows.followerId,
      inviterName: users.displayName,
    })
    .from(follows)
    .leftJoin(users, eq(follows.followerId, users.id))
    .where(
      and(
        eq(follows.followeeId, userId),
        eq(follows.state, 'approved'),
        gte(follows.approvedAt, windowStart),
      ),
    )
    .orderBy(asc(follows.approvedAt))
    .limit(1)

  if (!follow?.inviterUserId) return null

  return {
    inviterUserId: follow.inviterUserId,
    inviterName: follow.inviterName,
    sourceId: follow.id,
    sourceType: 'follow',
  }
}

export type InviteReflection = {
  invitationId: string
  inviteeUserId: string
  handle: string | null
  displayName: string | null
  avatarColor: string | null
  joinedAt: Date
  invitedAt: Date
  acceptedAt: Date | null
  relationship: RelationshipResult
}

// Lists users that this player previously invited (via the SMS-style
// FriendInvitation flow) who have since joined Joshing AND don't already have
// a resolved connection with the player. Used by the Find Friends page
// Block 3 ("here are people you nudged who showed up").
//
// Two exclusion layers, because there are two relationship models in this
// codebase's history:
// - The SQL's NOT EXISTS against the legacy "Friendship" table (still a real
//   table — despite looking stale, it's frozen-but-present, see
//   src/server/db/schema.ts's `friendships` export) catches pre-follow-model
//   connections that were never migrated into `follows`.
// - The post-fetch `relationship.state === 'friends'` check below catches
//   everything formed under the CURRENT model: nothing has ever INSERTed into
//   Friendship since the follow model shipped, so a same-day mutual follow
//   would otherwise sail through the SQL check and still get listed as
//   "not yet friended." getRelationships (already fetched here for the
//   isBlocked filter) is the canonical follows-based relationship read, so
//   this reuses it rather than hand-rolling a second follows NOT EXISTS.
// Both stay: dropping either regresses coverage for the model it protects.
export async function listInviteReflections(userId: string, limit = 20): Promise<InviteReflection[]> {
  const rows = await db.execute<{
    invitation_id: string
    invitee_user_id: string
    handle: string | null
    display_name: string | null
    avatar_color: string | null
    joined_at: Date
    invited_at: Date
    accepted_at: Date | null
  }>(sql`
    SELECT
      fi."id"             AS invitation_id,
      fi."inviteeUserId"  AS invitee_user_id,
      u."handle"          AS handle,
      u."display_name"    AS display_name,
      u."avatar_color"    AS avatar_color,
      u."created_at"      AS joined_at,
      fi."sentAt"         AS invited_at,
      fi."acceptedAt"     AS accepted_at
    FROM "FriendInvitation" fi
    JOIN "User" u ON u."id" = fi."inviteeUserId"
    WHERE fi."inviterUserId" = ${userId}
      AND fi."inviteeUserId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Friendship" f
        WHERE f."status" IN ('active', 'pending')
          AND (
            (f."userAId" = ${userId} AND f."userBId" = u."id")
            OR (f."userAId" = u."id" AND f."userBId" = ${userId})
          )
      )
    ORDER BY u."created_at" DESC
    LIMIT ${limit}
  `)

  if (rows.rows.length === 0) return []

  const inviteeIds = rows.rows.map((row) => row.invitee_user_id)
  const relationships = await getRelationships(userId, inviteeIds)

  const result: InviteReflection[] = []
  for (const row of rows.rows) {
    const relationship = relationships.get(row.invitee_user_id)
    if (!relationship || relationship.isBlocked) continue
    if (relationship.state === 'friends') continue
    result.push({
      invitationId: row.invitation_id,
      inviteeUserId: row.invitee_user_id,
      handle: row.handle,
      displayName: row.display_name,
      avatarColor: row.avatar_color,
      joinedAt: new Date(row.joined_at),
      invitedAt: new Date(row.invited_at),
      acceptedAt: row.accepted_at ? new Date(row.accepted_at) : null,
      relationship,
    })
  }
  return result
}
