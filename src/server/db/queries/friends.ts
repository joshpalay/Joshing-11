import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  db,
  declaredInterests,
  feedItems,
  follows,
  joshingGameResponses,
  masteryEvents,
  users,
} from '@/server/db';
import { DIRECT_SENT_FEED_SOURCE_TYPE } from '@/server/feed/visibility';

export type User = typeof users.$inferSelect;
export type Follow = typeof follows.$inferSelect;

// A person row in the friends hub. `youFollow` / `followsYou` let the UI label
// each row (Following / Follows you / Follow back) and `youFollow && followsYou`
// is the mutual ("friend") case.
export type HubPerson = {
  id: string
  displayName: string
  declaredInterests: string[]
  sharedInterests: string[]
  lastActiveAt: Date | null
  youFollow: boolean
  followsYou: boolean
}

export type IncomingFollowRequest = {
  // The pending follow edge id — drives approve/ignore.
  id: string
  requesterId: string
  requesterName: string
  suggestedInterests: string[]
  personalNote: string | null
  createdAt: Date
}

export type OutboundFollowRequest = {
  // The pending follow edge id — drives cancel.
  id: string
  recipientId: string
  recipientName: string
  personalNote: string | null
  createdAt: Date
}

export type FriendsHub = {
  // People I follow (approved outbound).
  following: HubPerson[]
  // People who follow me (approved inbound).
  followers: HubPerson[]
  // Follow requests awaiting my approval (pending inbound).
  incomingRequests: IncomingFollowRequest[]
  // My follow requests awaiting the other person's approval (pending outbound).
  outboundRequests: OutboundFollowRequest[]
  // My own gate on new followers.
  followPrivacy: 'public' | 'approval_required'
}

function displayName(name: string | null, fallback: string): string {
  return name?.trim() || fallback
}

function normalizeSuggestedInterests(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('suggestedInterests' in value)) return []

  const suggestedInterests = (value as { suggestedInterests?: unknown }).suggestedInterests
  if (!Array.isArray(suggestedInterests)) return []

  return suggestedInterests
    .filter((interest): interest is string => typeof interest === 'string')
    .map((interest) => interest.trim())
    .filter(Boolean)
}

/**
 * Returns the set of users `userId` follows (approved outbound edges). This is
 * the directional "people I follow" set — NOT necessarily reciprocal.
 */
export async function getFollowing(userId: string): Promise<User[]> {
  const rows = await db
    .select({ user: users })
    .from(follows)
    .innerJoin(users, eq(users.id, follows.followeeId))
    .where(and(eq(follows.followerId, userId), eq(follows.state, 'approved')))
    .orderBy(asc(users.displayName), asc(users.phoneNumber))
  return rows.map((row) => row.user)
}

/**
 * Returns the set of users who follow `userId` (approved inbound edges) — "my
 * followers", the broadcast / friend_answered fan-out audience.
 */
export async function getFollowers(userId: string): Promise<User[]> {
  const rows = await db
    .select({ user: users })
    .from(follows)
    .innerJoin(users, eq(users.id, follows.followerId))
    .where(and(eq(follows.followeeId, userId), eq(follows.state, 'approved')))
    .orderBy(asc(users.displayName), asc(users.phoneNumber))
  return rows.map((row) => row.user)
}

/**
 * Returns users in a mutual follow with `userId` (both directions approved).
 * This is the canonical "friend" relationship that the symmetric `getFriends`
 * delegated to before the follow model — reciprocal features (inside jokes,
 * shared interests, ceremony) read this.
 */
export async function getMutualFollows(userId: string): Promise<User[]> {
  const back = alias(follows, 'follows_back')
  const rows = await db
    .select({ user: users })
    .from(follows)
    .innerJoin(
      back,
      and(
        eq(back.followerId, follows.followeeId),
        eq(back.followeeId, userId),
        eq(back.state, 'approved'),
      ),
    )
    .innerJoin(users, eq(users.id, follows.followeeId))
    .where(and(eq(follows.followerId, userId), eq(follows.state, 'approved')))
    .orderBy(asc(users.displayName), asc(users.phoneNumber))
  return rows.map((row) => row.user)
}

/**
 * Mutual-follow shim. Pre-follow-model `getFriends` meant "active symmetric
 * friendship"; under the directional model that is exactly a mutual follow.
 * The ~18 reciprocal call-sites keep calling `getFriends` unchanged.
 */
export async function getFriends(userId: string): Promise<User[]> {
  return getMutualFollows(userId)
}

export async function areFriends(userAId: string, userBId: string): Promise<boolean> {
  if (userAId === userBId) return false
  const rows = await db
    .select({ followerId: follows.followerId, followeeId: follows.followeeId })
    .from(follows)
    .where(
      and(
        eq(follows.state, 'approved'),
        or(
          and(eq(follows.followerId, userAId), eq(follows.followeeId, userBId)),
          and(eq(follows.followerId, userBId), eq(follows.followeeId, userAId)),
        ),
      ),
    )
  return rows.length === 2
}

export async function getRecentDirectSendRecipients(userId: string, limit = 3): Promise<User[]> {
  if (limit <= 0) return [];

  const recentRows = await db
    .select({ recipientUserId: feedItems.recipientUserId })
    .from(feedItems)
    .where(and(
      eq(feedItems.sourceUserId, userId),
      eq(feedItems.sourceType, DIRECT_SENT_FEED_SOURCE_TYPE),
    ))
    .orderBy(desc(feedItems.sourceEventAt))
    .limit(50);

  const orderedDistinctIds: string[] = [];
  const seen = new Set<string>();
  for (const row of recentRows) {
    if (seen.has(row.recipientUserId)) continue;
    seen.add(row.recipientUserId);
    orderedDistinctIds.push(row.recipientUserId);
    if (orderedDistinctIds.length >= limit) break;
  }
  if (orderedDistinctIds.length === 0) return [];

  const friends = await getFriends(userId);
  const friendsById = new Map(friends.map((friend) => [friend.id, friend] as const));

  const result: User[] = [];
  for (const id of orderedDistinctIds) {
    const friend = friendsById.get(id);
    if (friend) result.push(friend);
  }
  return result;
}

// Derives a "last active" timestamp per user by taking the most recent of two
// signals — answering a question (JoshingGameResponse.answeredAt) and being
// awarded mastery (MASTERY_EVENTS.created_at). Both are direct evidence the
// user did something, and together they survive when only one is present
// (e.g. an authored question earns mastery without an answeredAt row).
async function getLastActiveByUserId(userIds: string[]): Promise<Map<string, Date>> {
  if (userIds.length === 0) return new Map()

  const [responseRows, masteryRows] = await Promise.all([
    db
      .select({
        userId: joshingGameResponses.userId,
        lastAt: sql<Date>`max(${joshingGameResponses.answeredAt})`.as('last_at'),
      })
      .from(joshingGameResponses)
      .where(and(
        inArray(joshingGameResponses.userId, userIds),
        sql`${joshingGameResponses.answeredAt} is not null`,
      ))
      .groupBy(joshingGameResponses.userId),
    db
      .select({
        userId: masteryEvents.userId,
        lastAt: sql<Date>`max(${masteryEvents.createdAt})`.as('last_at'),
      })
      .from(masteryEvents)
      .where(inArray(masteryEvents.userId, userIds))
      .groupBy(masteryEvents.userId),
  ])

  const lastActive = new Map<string, Date>()
  for (const row of [...responseRows, ...masteryRows]) {
    if (!row.lastAt) continue
    const next = row.lastAt instanceof Date ? row.lastAt : new Date(row.lastAt)
    if (Number.isNaN(next.getTime())) continue
    const existing = lastActive.get(row.userId)
    if (!existing || next > existing) lastActive.set(row.userId, next)
  }
  return lastActive
}

export async function getFriendsHub(userId: string): Promise<FriendsHub> {
  // All follow edges touching me, in either direction.
  const edges = await db
    .select({
      id: follows.id,
      followerId: follows.followerId,
      followeeId: follows.followeeId,
      state: follows.state,
      personalNote: follows.personalNote,
      requestContext: follows.requestContext,
      createdAt: follows.createdAt,
    })
    .from(follows)
    .where(or(eq(follows.followerId, userId), eq(follows.followeeId, userId)))

  const followingIds = new Set<string>()
  const followerIds = new Set<string>()
  const incoming: Array<{ id: string; requesterId: string; suggestedInterests: string[]; personalNote: string | null; createdAt: Date }> = []
  const outbound: Array<{ id: string; recipientId: string; personalNote: string | null; createdAt: Date }> = []

  for (const edge of edges) {
    const outboundEdge = edge.followerId === userId
    const other = outboundEdge ? edge.followeeId : edge.followerId
    if (edge.state === 'approved') {
      if (outboundEdge) followingIds.add(other)
      else followerIds.add(other)
    } else {
      // pending
      if (outboundEdge) {
        outbound.push({ id: edge.id, recipientId: other, personalNote: edge.personalNote, createdAt: edge.createdAt })
      } else {
        incoming.push({
          id: edge.id,
          requesterId: other,
          suggestedInterests: normalizeSuggestedInterests(edge.requestContext),
          personalNote: edge.personalNote,
          createdAt: edge.createdAt,
        })
      }
    }
  }

  const personIds = Array.from(new Set<string>([...followingIds, ...followerIds]))
  const requesterIds = incoming.map((r) => r.requesterId)
  const recipientIds = outbound.map((r) => r.recipientId)
  const allIds = Array.from(new Set<string>([...personIds, ...requesterIds, ...recipientIds]))

  const userRows = allIds.length === 0
    ? []
    : await db
      .select({ id: users.id, displayName: users.displayName, phoneNumber: users.phoneNumber })
      .from(users)
      .where(inArray(users.id, allIds))
  const usersById = new Map(userRows.map((row) => [row.id, row] as const))

  const interestRows = allIds.length === 0
    ? []
    : await db
      .select({ userId: declaredInterests.userId, domain: declaredInterests.domain })
      .from(declaredInterests)
      .where(and(
        eq(declaredInterests.isActive, true),
        inArray(declaredInterests.userId, [userId, ...allIds]),
      ))
      .orderBy(asc(declaredInterests.domain))

  const interestsByUser = new Map<string, string[]>()
  for (const row of interestRows) {
    const current = interestsByUser.get(row.userId) ?? []
    current.push(row.domain)
    interestsByUser.set(row.userId, current)
  }
  const viewerInterests = new Set(interestsByUser.get(userId) ?? [])

  const lastActiveByUser = personIds.length === 0
    ? new Map<string, Date>()
    : await getLastActiveByUserId(personIds)

  const [me] = await db
    .select({ followPrivacy: users.followPrivacy })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  function toPerson(id: string): HubPerson {
    const user = usersById.get(id)
    const name = displayName(user?.displayName ?? null, user?.phoneNumber ?? '')
    const personInterests = interestsByUser.get(id) ?? []
    return {
      id,
      displayName: name,
      declaredInterests: personInterests,
      sharedInterests: personInterests.filter((interest) => viewerInterests.has(interest)),
      lastActiveAt: lastActiveByUser.get(id) ?? null,
      youFollow: followingIds.has(id),
      followsYou: followerIds.has(id),
    }
  }

  const byName = (a: HubPerson, b: HubPerson) => a.displayName.localeCompare(b.displayName)

  return {
    following: Array.from(followingIds).map(toPerson).sort(byName),
    followers: Array.from(followerIds).map(toPerson).sort(byName),
    incomingRequests: incoming
      .map((request) => {
        const user = usersById.get(request.requesterId)
        return {
          id: request.id,
          requesterId: request.requesterId,
          requesterName: displayName(user?.displayName ?? null, user?.phoneNumber ?? ''),
          suggestedInterests: request.suggestedInterests,
          personalNote: request.personalNote,
          createdAt: request.createdAt,
        }
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    outboundRequests: outbound
      .map((request) => {
        const user = usersById.get(request.recipientId)
        return {
          id: request.id,
          recipientId: request.recipientId,
          recipientName: displayName(user?.displayName ?? null, user?.phoneNumber ?? ''),
          personalNote: request.personalNote,
          createdAt: request.createdAt,
        }
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    followPrivacy: me?.followPrivacy ?? 'approval_required',
  }
}

/**
 * Returns the viewer's 1st-degree mutual-follow ids and 2nd-degree
 * (mutual-follows of mutual-follows) ids, with the extended set de-duplicated
 * against direct mutuals and the viewer. Used by the Daily 5 picker to rank
 * eligible user-authored questions: direct first, then extended, then everyone.
 *
 * "Direct" stays mutual-follow (the migrated symmetric friendship), preserving
 * the picker's ranking semantics under the follow model.
 */
export async function getFriendAndFoFUserIds(userId: string): Promise<{
  direct: Set<string>;
  extended: Set<string>;
}> {
  const directUsers = await getMutualFollows(userId)
  const direct = new Set<string>(directUsers.map((user) => user.id))

  if (direct.size === 0) {
    return { direct, extended: new Set<string>() }
  }

  const directList = [...direct]
  const extended = new Set<string>()
  const seen = new Set<string>([userId, ...directList])

  // Mutual follows of each direct mutual, in a single bounded query: an edge
  // direct→candidate that has an approved reverse edge candidate→direct.
  const back = alias(follows, 'fof_back')
  const fofRows = await db
    .select({ candidate: follows.followeeId })
    .from(follows)
    .innerJoin(
      back,
      and(
        eq(back.followerId, follows.followeeId),
        eq(back.followeeId, follows.followerId),
        eq(back.state, 'approved'),
      ),
    )
    .where(and(eq(follows.state, 'approved'), inArray(follows.followerId, directList)))

  for (const row of fofRows) {
    if (!seen.has(row.candidate)) extended.add(row.candidate)
  }

  return { direct, extended }
}
