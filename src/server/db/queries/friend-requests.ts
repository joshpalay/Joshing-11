import { and, eq, inArray, or } from 'drizzle-orm'

import { db, follows } from '@/server/db'

export type RelationshipState =
  | 'none'
  | 'pending_outbound' // I requested to follow them; awaiting their approval
  | 'pending_inbound' // they requested to follow me; awaiting my approval
  | 'following' // I follow them (approved), one-directional
  | 'follows_you' // they follow me (approved); I don't follow back
  | 'friends' // mutual follow (both directions approved)

export type RelationshipResult = {
  state: RelationshipState
  // The follow-edge id that drives the next action:
  //   pending_outbound / following / friends -> my outbound edge (cancel / unfollow)
  //   pending_inbound                        -> their inbound edge (approve / ignore)
  //   follows_you / none                     -> null (the action is to create a follow)
  friendshipId: string | null
  // When the relevant approved edge formed (mutual or one-directional follow).
  formedAt: Date | null
  // Retained for API/type compatibility with list surfaces that filter on it.
  // Explicit blocking is not modelled under the follow model (an unwanted
  // follower is handled by the approval gate / unfollow), so this is always
  // false now.
  isBlocked: boolean
}

type EdgeRow = {
  id: string
  followerId: string
  followeeId: string
  state: 'pending' | 'approved'
  approvedAt: Date | null
}

// Resolve the relationship from the viewer's two directional edges.
//   outbound = viewer -> target, inbound = target -> viewer
function resolve(outbound: EdgeRow | undefined, inbound: EdgeRow | undefined): RelationshipResult {
  const out = outbound?.state
  const inb = inbound?.state

  if (out === 'approved' && inb === 'approved') {
    return { state: 'friends', friendshipId: outbound!.id, formedAt: outbound!.approvedAt, isBlocked: false }
  }
  // An incoming request I can act on takes precedence so I can approve it.
  if (inb === 'pending') {
    return { state: 'pending_inbound', friendshipId: inbound!.id, formedAt: null, isBlocked: false }
  }
  if (out === 'pending') {
    return { state: 'pending_outbound', friendshipId: outbound!.id, formedAt: null, isBlocked: false }
  }
  if (out === 'approved') {
    return { state: 'following', friendshipId: outbound!.id, formedAt: outbound!.approvedAt, isBlocked: false }
  }
  if (inb === 'approved') {
    return { state: 'follows_you', friendshipId: null, formedAt: null, isBlocked: false }
  }
  return { state: 'none', friendshipId: null, formedAt: null, isBlocked: false }
}

// Single source of truth for the viewer's relationship to a target user.
export async function getRelationship(
  viewerId: string,
  targetId: string,
): Promise<RelationshipResult> {
  if (viewerId === targetId) {
    return { state: 'none', friendshipId: null, formedAt: null, isBlocked: false }
  }

  const rows = await db
    .select({
      id: follows.id,
      followerId: follows.followerId,
      followeeId: follows.followeeId,
      state: follows.state,
      approvedAt: follows.approvedAt,
    })
    .from(follows)
    .where(
      or(
        and(eq(follows.followerId, viewerId), eq(follows.followeeId, targetId)),
        and(eq(follows.followerId, targetId), eq(follows.followeeId, viewerId)),
      ),
    )

  const outbound = rows.find((row) => row.followerId === viewerId)
  const inbound = rows.find((row) => row.followerId === targetId)
  return resolve(outbound, inbound)
}

// Bulk lookup variant for list surfaces (search results, contact matches).
// Returns a Map keyed by target user id. Same precedence as getRelationship.
export async function getRelationships(
  viewerId: string,
  targetIds: string[],
): Promise<Map<string, RelationshipResult>> {
  const result = new Map<string, RelationshipResult>()
  if (targetIds.length === 0) return result

  const uniqueTargets = Array.from(new Set(targetIds.filter((id) => id !== viewerId)))
  if (uniqueTargets.length === 0) return result

  const rows = await db
    .select({
      id: follows.id,
      followerId: follows.followerId,
      followeeId: follows.followeeId,
      state: follows.state,
      approvedAt: follows.approvedAt,
    })
    .from(follows)
    .where(
      or(
        and(eq(follows.followerId, viewerId), inArray(follows.followeeId, uniqueTargets)),
        and(eq(follows.followeeId, viewerId), inArray(follows.followerId, uniqueTargets)),
      ),
    )

  const outboundByTarget = new Map<string, EdgeRow>()
  const inboundByTarget = new Map<string, EdgeRow>()
  for (const row of rows) {
    if (row.followerId === viewerId) outboundByTarget.set(row.followeeId, row)
    else inboundByTarget.set(row.followerId, row)
  }

  for (const targetId of uniqueTargets) {
    result.set(targetId, resolve(outboundByTarget.get(targetId), inboundByTarget.get(targetId)))
  }

  return result
}
