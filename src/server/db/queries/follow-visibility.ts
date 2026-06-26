import { and, eq, exists, sql } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { db, follows } from '@/server/db';

// Phase 1 relationship model: "friend" means a MUTUAL (bidirectional) follow —
// an approved Follow edge in BOTH directions. Visibility of a user's content
// (From-Friends feed, friend-answered milestones, friends-only questions) is
// gated on friendship, NOT on a single one-directional approved edge.
//
// The directional Follow table is intentionally RETAINED (a future phase
// re-introduces asymmetric following); these helpers are the seam. When
// following returns, relax the visibility gate from `mutualFollowApproved` back
// to a single `approvedFollowExists` at the call sites that should allow it.

/**
 * SQL predicate: an approved Follow edge `follower -> followee` exists. Either
 * argument may be a literal user id or a column reference (so it correlates to
 * the outer query). `aliasName` must be unique within the query.
 */
export function approvedFollowExists(
  followerId: AnyPgColumn | string,
  followeeId: AnyPgColumn | string,
  aliasName: string,
) {
  const edge = alias(follows, aliasName);
  return exists(
    db
      .select({ one: sql`1` })
      .from(edge)
      .where(
        and(
          eq(edge.followerId, followerId),
          eq(edge.followeeId, followeeId),
          eq(edge.state, 'approved'),
        ),
      ),
  );
}

/**
 * SQL predicate: `viewerId` and the user in `otherUserColumn` are MUTUAL friends
 * — an approved Follow edge exists in BOTH directions. `aliasPrefix` must be
 * unique within the query (two follow aliases are derived from it).
 */
export function mutualFollowApproved(
  viewerId: string,
  otherUserColumn: AnyPgColumn,
  aliasPrefix: string,
) {
  return and(
    approvedFollowExists(viewerId, otherUserColumn, `${aliasPrefix}_fwd`),
    approvedFollowExists(otherUserColumn, viewerId, `${aliasPrefix}_rev`),
  );
}
