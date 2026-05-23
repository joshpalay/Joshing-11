import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';

import {
  db,
  declaredInterests,
  feedItems,
  friendships,
  joshingGameResponses,
  masteryEvents,
  users,
} from '@/server/db';
import { DIRECT_SENT_FEED_SOURCE_TYPE } from '@/server/feed/visibility';

export type User = typeof users.$inferSelect;
export type Friendship = typeof friendships.$inferSelect;

export type FriendHubFriend = {
  id: string
  displayName: string
  declaredInterests: string[]
  sharedInterests: string[]
  lastActiveAt: Date | null
}

export type IncomingFriendRequest = {
  id: string
  requesterId: string
  requesterName: string
  suggestedInterests: string[]
  createdAt: Date
}

export type FriendsHub = {
  friends: FriendHubFriend[]
  incomingRequests: IncomingFriendRequest[]
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

export async function getFriends(userId: string): Promise<User[]> {
  const rows = await db
    .select({ userAId: friendships.userAId, userBId: friendships.userBId })
    .from(friendships)
    .where(and(
      eq(friendships.status, 'active'),
      or(eq(friendships.userAId, userId), eq(friendships.userBId, userId)),
    ));
  const friendIds = rows.map((friendship) => (
    friendship.userAId === userId ? friendship.userBId : friendship.userAId
  ));
  if (friendIds.length === 0) return [];

  return db
    .select()
    .from(users)
    .where(inArray(users.id, friendIds))
    .orderBy(asc(users.displayName), asc(users.phoneNumber));
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
  const activeFriendships = await db
    .select({ userAId: friendships.userAId, userBId: friendships.userBId })
    .from(friendships)
    .where(and(
      eq(friendships.status, 'active'),
      or(eq(friendships.userAId, userId), eq(friendships.userBId, userId)),
    ))

  const friendIds = activeFriendships.map((friendship) => (
    friendship.userAId === userId ? friendship.userBId : friendship.userAId
  ))

  const friendRows = friendIds.length === 0
    ? []
    : await db
      .select({
        id: users.id,
        displayName: users.displayName,
        phoneNumber: users.phoneNumber,
      })
      .from(users)
      .where(inArray(users.id, friendIds))
      .orderBy(asc(users.displayName), asc(users.phoneNumber))

  const interestRows = friendIds.length === 0
    ? []
    : await db
      .select({ userId: declaredInterests.userId, domain: declaredInterests.domain })
      .from(declaredInterests)
      .where(and(
        eq(declaredInterests.isActive, true),
        inArray(declaredInterests.userId, [userId, ...friendIds]),
      ))
      .orderBy(asc(declaredInterests.domain))

  const interestsByUser = new Map<string, string[]>()
  for (const row of interestRows) {
    const current = interestsByUser.get(row.userId) ?? []
    current.push(row.domain)
    interestsByUser.set(row.userId, current)
  }

  const viewerInterests = new Set(interestsByUser.get(userId) ?? [])

  const lastActiveByUser = friendIds.length === 0
    ? new Map<string, Date>()
    : await getLastActiveByUserId(friendIds)

  const incomingRows = await db
    .select({
      id: friendships.id,
      requesterId: users.id,
      requesterDisplayName: users.displayName,
      requesterPhoneNumber: users.phoneNumber,
      requestContext: friendships.requestContext,
      createdAt: friendships.createdAt,
    })
    .from(friendships)
    .innerJoin(users, eq(users.id, friendships.requestedByUserId))
    .where(and(
      eq(friendships.status, 'pending'),
      ne(friendships.requestedByUserId, userId),
      or(eq(friendships.userAId, userId), eq(friendships.userBId, userId)),
    ))
    .orderBy(asc(friendships.createdAt))

  return {
    friends: friendRows.map((friend) => {
      const friendInterests = interestsByUser.get(friend.id) ?? []
      return {
        id: friend.id,
        displayName: displayName(friend.displayName, friend.phoneNumber),
        declaredInterests: friendInterests,
        sharedInterests: friendInterests.filter((interest) => viewerInterests.has(interest)),
        lastActiveAt: lastActiveByUser.get(friend.id) ?? null,
      }
    }),
    incomingRequests: incomingRows.map((request) => ({
      id: request.id,
      requesterId: request.requesterId,
      requesterName: displayName(request.requesterDisplayName, request.requesterPhoneNumber),
      suggestedInterests: normalizeSuggestedInterests(request.requestContext),
      createdAt: request.createdAt,
    })),
  }
}

export async function getFriendship(userAId: string, userBId: string): Promise<Friendship | null> {
  const [friendship] = await db
    .select()
    .from(friendships)
    .where(or(
      and(eq(friendships.userAId, userAId), eq(friendships.userBId, userBId)),
      and(eq(friendships.userAId, userBId), eq(friendships.userBId, userAId)),
    ))
    .limit(1);

  return friendship ?? null;
}

export async function areFriends(userAId: string, userBId: string): Promise<boolean> {
  if (userAId === userBId) return false;
  const friendship = await getFriendship(userAId, userBId);
  return friendship?.status === 'active';
}

/**
 * Returns the viewer's 1st-degree friend ids and 2nd-degree (friends of
 * friends) ids, with FoF de-duplicated against direct friends and the
 * viewer themselves. Used by the Daily 5 picker to rank eligible
 * user-authored questions: direct friends first, then FoF, then everyone
 * else.
 *
 * The friend graph is small and uncached, so we run two normal queries
 * rather than a recursive CTE — the second pass is bounded by
 * `directIds.length` which is itself indexed via the existing
 * Friendship_userAId_status_idx / Friendship_userBId_status_idx pair.
 */
export async function getFriendAndFoFUserIds(userId: string): Promise<{
  direct: Set<string>;
  extended: Set<string>;
}> {
  const directRows = await db
    .select({ userAId: friendships.userAId, userBId: friendships.userBId })
    .from(friendships)
    .where(and(
      eq(friendships.status, 'active'),
      or(eq(friendships.userAId, userId), eq(friendships.userBId, userId)),
    ));

  const direct = new Set<string>();
  for (const row of directRows) {
    const friendId = row.userAId === userId ? row.userBId : row.userAId;
    direct.add(friendId);
  }

  if (direct.size === 0) {
    return { direct, extended: new Set<string>() };
  }

  const directList = [...direct];
  const fofRows = await db
    .select({ userAId: friendships.userAId, userBId: friendships.userBId })
    .from(friendships)
    .where(and(
      eq(friendships.status, 'active'),
      or(
        inArray(friendships.userAId, directList),
        inArray(friendships.userBId, directList),
      ),
    ));

  const extended = new Set<string>();
  for (const row of fofRows) {
    if (directList.includes(row.userAId) && row.userBId !== userId && !direct.has(row.userBId)) {
      extended.add(row.userBId);
    }
    if (directList.includes(row.userBId) && row.userAId !== userId && !direct.has(row.userAId)) {
      extended.add(row.userAId);
    }
  }

  return { direct, extended };
}
