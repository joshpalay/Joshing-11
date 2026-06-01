import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, friendships } from '@/server/db';
import { friendshipPair } from '@/server/friends/friendships';

export type RelationshipState =
  | 'none'
  | 'pending_outbound'
  | 'pending_inbound'
  | 'friends'
  | 'recently_sent';

export type RelationshipResult = {
  state: RelationshipState;
  // Present when state is pending_outbound, pending_inbound, or friends —
  // so callers can drive accept/cancel/unfriend actions without a second
  // lookup. null when the row doesn't exist or has been resolved.
  friendshipId: string | null;
  // True when the target party has soft-removed this friendship. The UI
  // never shows a separate "blocked" state — to the viewer it looks like
  // "none" — but POST /api/friend-requests refuses with 404 (doesn't
  // reveal the block). Callers that render add-friend affordances on
  // lists (search results, contact matches) should filter rows where
  // isBlocked === true before rendering.
  isBlocked: boolean;
};

const RECENTLY_SENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Single source of truth for the viewer's relationship to a target user.
// Resolution order (highest precedence first):
//   1. status='active' row                    -> 'friends'
//   2. status='removed' by target             -> 'none' + isBlocked: true
//      status='removed' by viewer             -> 'none' (the viewer chose
//                                                to disconnect; they can re-add)
//   3. status='pending', requested by viewer  -> 'pending_outbound'
//   4. status='pending', requested by target  -> 'pending_inbound'
//   5. status in ('declined','expired') with resolvedAt within 30 days -> 'recently_sent'
//   6. otherwise                              -> 'none'
export async function getRelationship(
  viewerId: string,
  targetId: string,
  now: Date = new Date(),
): Promise<RelationshipResult> {
  if (viewerId === targetId) {
    return { state: 'none', friendshipId: null, isBlocked: false };
  }

  const pair = friendshipPair(viewerId, targetId);
  const [row] = await db
    .select()
    .from(friendships)
    .where(and(eq(friendships.userAId, pair.userAId), eq(friendships.userBId, pair.userBId)))
    .limit(1);

  if (!row) {
    return { state: 'none', friendshipId: null, isBlocked: false };
  }

  if (row.status === 'active') {
    return { state: 'friends', friendshipId: row.id, isBlocked: false };
  }

  if (row.status === 'removed') {
    const removedByTarget = row.removedByUserId === targetId;
    return { state: 'none', friendshipId: null, isBlocked: removedByTarget };
  }

  if (row.status === 'pending') {
    return {
      state: row.requestedByUserId === viewerId ? 'pending_outbound' : 'pending_inbound',
      friendshipId: row.id,
      isBlocked: false,
    };
  }

  if (row.status === 'declined' || row.status === 'expired') {
    const resolvedAt = row.resolvedAt;
    if (resolvedAt && now.getTime() - resolvedAt.getTime() < RECENTLY_SENT_WINDOW_MS) {
      // Only the original requester is gated by the cooldown — the
      // declinee can re-send immediately if they change their mind.
      if (row.requestedByUserId === viewerId) {
        return { state: 'recently_sent', friendshipId: null, isBlocked: false };
      }
    }
  }

  return { state: 'none', friendshipId: null, isBlocked: false };
}

// Bulk lookup variant for list surfaces (search results, contact matches).
// Returns a Map keyed by target user id. Same precedence as getRelationship.
export async function getRelationships(
  viewerId: string,
  targetIds: string[],
  now: Date = new Date(),
): Promise<Map<string, RelationshipResult>> {
  const result = new Map<string, RelationshipResult>();
  if (targetIds.length === 0) return result;

  const uniqueTargets = Array.from(new Set(targetIds.filter((id) => id !== viewerId)));
  if (uniqueTargets.length === 0) return result;

  const rows = await db
    .select()
    .from(friendships)
    .where(
      and(
        sql`(${friendships.userAId} = ${viewerId} AND ${friendships.userBId} IN ${uniqueTargets})
          OR (${friendships.userBId} = ${viewerId} AND ${friendships.userAId} IN ${uniqueTargets})`,
        inArray(friendships.status, ['active', 'pending', 'declined', 'expired', 'removed']),
      ),
    );

  const rowsByOther = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const otherId = row.userAId === viewerId ? row.userBId : row.userAId;
    rowsByOther.set(otherId, row);
  }

  for (const targetId of uniqueTargets) {
    const row = rowsByOther.get(targetId);
    if (!row) {
      result.set(targetId, { state: 'none', friendshipId: null, isBlocked: false });
      continue;
    }
    if (row.status === 'active') {
      result.set(targetId, { state: 'friends', friendshipId: row.id, isBlocked: false });
      continue;
    }
    if (row.status === 'removed') {
      const removedByTarget = row.removedByUserId === targetId;
      result.set(targetId, { state: 'none', friendshipId: null, isBlocked: removedByTarget });
      continue;
    }
    if (row.status === 'pending') {
      result.set(targetId, {
        state: row.requestedByUserId === viewerId ? 'pending_outbound' : 'pending_inbound',
        friendshipId: row.id,
        isBlocked: false,
      });
      continue;
    }
    if (row.status === 'declined' || row.status === 'expired') {
      const resolvedAt = row.resolvedAt;
      if (
        resolvedAt &&
        now.getTime() - resolvedAt.getTime() < RECENTLY_SENT_WINDOW_MS &&
        row.requestedByUserId === viewerId
      ) {
        result.set(targetId, { state: 'recently_sent', friendshipId: null, isBlocked: false });
        continue;
      }
    }
    result.set(targetId, { state: 'none', friendshipId: null, isBlocked: false });
  }

  return result;
}
