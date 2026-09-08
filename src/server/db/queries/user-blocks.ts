import { and, desc, eq, inArray, or } from 'drizzle-orm'

import { cleanupFollowRequestActivity } from '@/server/friends/friendships'
import { db, follows, userBlocks, users } from '@/server/db'

// B-FRIENDS-SAFETY-01 Phase 1. A block is stored one-directional (who
// pressed the button) but enforced BIDIRECTIONALLY on every read -- see
// isBlockedBetween / blockedIdsAmong below, wired into the shared
// getRelationship / getRelationships resolver in
// src/server/db/queries/friend-requests.ts.

// Idempotent: blocking an already-blocked pair is a no-op on the row itself.
// Always tears down any existing follow edge in EITHER direction (a block is
// a hard boundary -- an existing mutual/one-directional follow must not
// survive it) and cleans up the matching follow-request activity rows.
export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  await db.insert(userBlocks).values({ blockerId, blockedId }).onConflictDoNothing()

  const edges = await db
    .delete(follows)
    .where(
      or(
        and(eq(follows.followerId, blockerId), eq(follows.followeeId, blockedId)),
        and(eq(follows.followerId, blockedId), eq(follows.followeeId, blockerId)),
      ),
    )
    .returning({ id: follows.id })

  await Promise.all(edges.map((edge) => cleanupFollowRequestActivity(edge.id)))
}

// Does NOT restore any follow edge that blockUser tore down -- unblocking
// returns the pair to 'none', not to their prior relationship.
export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await db
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
}

// True if either user has blocked the other.
export async function isBlockedBetween(userIdA: string, userIdB: string): Promise<boolean> {
  const [row] = await db
    .select({ id: userBlocks.id })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, userIdA), eq(userBlocks.blockedId, userIdB)),
        and(eq(userBlocks.blockerId, userIdB), eq(userBlocks.blockedId, userIdA)),
      ),
    )
    .limit(1)

  return Boolean(row)
}

// Bulk version for list surfaces (search results, contact matches, feed
// attribution): the subset of candidateIds that have a block with viewerId
// in either direction. One query instead of one-per-candidate.
export async function blockedIdsAmong(
  viewerId: string,
  candidateIds: string[],
): Promise<Set<string>> {
  const result = new Set<string>()
  if (candidateIds.length === 0) return result

  const rows = await db
    .select({ blockerId: userBlocks.blockerId, blockedId: userBlocks.blockedId })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, viewerId), inArray(userBlocks.blockedId, candidateIds)),
        and(eq(userBlocks.blockedId, viewerId), inArray(userBlocks.blockerId, candidateIds)),
      ),
    )

  for (const row of rows) {
    result.add(row.blockerId === viewerId ? row.blockedId : row.blockerId)
  }
  return result
}

export type BlockedUser = {
  id: string
  handle: string | null
  displayName: string | null
  avatarColor: string | null
  blockedAt: Date
}

// The people `blockerId` has blocked -- powers the "Blocked people" list in
// privacy settings. Only rows this user blocked themselves (not rows where
// they're the one who got blocked -- that side is never surfaced to them,
// per the not-distinguishable-from-not-found rule).
export async function listBlockedUsers(blockerId: string): Promise<BlockedUser[]> {
  const rows = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      avatarColor: users.avatarColor,
      blockedAt: userBlocks.createdAt,
    })
    .from(userBlocks)
    .innerJoin(users, eq(users.id, userBlocks.blockedId))
    .where(eq(userBlocks.blockerId, blockerId))
    .orderBy(desc(userBlocks.createdAt))

  return rows
}
