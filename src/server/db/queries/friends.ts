import { and, asc, count, desc, eq, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  db,
  declaredInterests,
  feedItems,
  follows,
  joshingGameResponses,
  masteryEvents,
  questions,
  users,
} from '@/server/db';
import { getRelationships, type RelationshipResult } from '@/server/db/queries/friend-requests';
import { DIRECT_SENT_FEED_SOURCE_TYPE } from '@/server/feed/visibility';
import { resolveDisplayName } from '@/server/lib/display-name';

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
  // Two warm activity facts for the friend row (PLR-14): how many questions this
  // person has created, and — of those — how many the viewer has answered (across
  // every surface). Not a ranking — never sort/compare friends by these
  // (anti-leaderboard, PRODUCT-CANON.md).
  authoredCount: number
  answeredByViewerCount: number
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

// Two per-friend question counts for the friends-list rows (PLR-14), both as
// single bulk aggregates over the friend-id set (no per-friend N+1):
//   • authored        — questions this person created (source 'authored', live)
//   • answeredByViewer — of THIS person's created questions, how many the viewer
//     has answered, across every surface. "Answered" = the viewer interacted
//     with it as an answer anywhere: a feed item they answered (correct OR
//     incorrect), a mastery event they earned (daily / catch-up / feed), or a
//     game response. The viewer's answered-question id set is unioned once and
//     intersected with each friend's authored set.
async function getFriendQuestionCounts(
  viewerId: string,
  friendIds: string[],
): Promise<Map<string, { authored: number; answeredByViewer: number }>> {
  if (friendIds.length === 0) return new Map()

  // Every question id the viewer has answered, from all answer-bearing surfaces.
  const viewerAnsweredQuestionIds = sql`
    select ${feedItems.questionId} from ${feedItems}
      where ${feedItems.recipientUserId} = ${viewerId} and ${feedItems.answerResult} is not null
    union
    select ${masteryEvents.questionId} from ${masteryEvents}
      where ${masteryEvents.answeredByUserId} = ${viewerId}
    union
    select ${joshingGameResponses.questionId} from ${joshingGameResponses}
      where ${joshingGameResponses.userId} = ${viewerId}
  `

  const [authoredRows, answeredRows] = await Promise.all([
    db
      .select({
        creatorId: questions.creatorId,
        count: sql<number>`count(*)::int`.as('count'),
      })
      .from(questions)
      .where(and(
        inArray(questions.creatorId, friendIds),
        eq(questions.source, 'authored'),
        sql`${questions.deletedAt} is null`,
      ))
      .groupBy(questions.creatorId),
    db
      .select({
        creatorId: questions.creatorId,
        count: sql<number>`count(distinct ${questions.id})::int`.as('count'),
      })
      .from(questions)
      .where(and(
        inArray(questions.creatorId, friendIds),
        eq(questions.source, 'authored'),
        sql`${questions.deletedAt} is null`,
        sql`${questions.id} in (${viewerAnsweredQuestionIds})`,
      ))
      .groupBy(questions.creatorId),
  ])

  const counts = new Map<string, { authored: number; answeredByViewer: number }>()
  const bump = (id: string | null, key: 'authored' | 'answeredByViewer', n: number) => {
    if (!id) return
    const current = counts.get(id) ?? { authored: 0, answeredByViewer: 0 }
    current[key] = Number(n) || 0
    counts.set(id, current)
  }
  for (const row of authoredRows) bump(row.creatorId, 'authored', row.count)
  for (const row of answeredRows) bump(row.creatorId, 'answeredByViewer', row.count)
  return counts
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
    } else if (edge.state === 'pending') {
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
    // 'declined' (B-FRIENDS-SAFETY-01 Phase 2): not a friend, a follower, or a
    // pending request -- fully skipped, same as if the edge didn't exist.
  }

  const personIds = Array.from(new Set<string>([...followingIds, ...followerIds]))
  const requesterIds = incoming.map((r) => r.requesterId)
  const recipientIds = outbound.map((r) => r.recipientId)
  const allIds = Array.from(new Set<string>([...personIds, ...requesterIds, ...recipientIds]))

  const userRows = allIds.length === 0
    ? []
    : await db
      .select({ id: users.id, displayName: users.displayName, handle: users.handle })
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

  const [lastActiveByUser, questionCountsByUser] = personIds.length === 0
    ? [new Map<string, Date>(), new Map<string, { authored: number; answeredByViewer: number }>()]
    : await Promise.all([
        getLastActiveByUserId(personIds),
        getFriendQuestionCounts(userId, personIds),
      ])

  const [me] = await db
    .select({ followPrivacy: users.followPrivacy })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  function toPerson(id: string): HubPerson {
    const user = usersById.get(id)
    const name = resolveDisplayName({ displayName: user?.displayName, handle: user?.handle })
    const personInterests = interestsByUser.get(id) ?? []
    return {
      id,
      displayName: name,
      declaredInterests: personInterests,
      sharedInterests: personInterests.filter((interest) => viewerInterests.has(interest)),
      lastActiveAt: lastActiveByUser.get(id) ?? null,
      youFollow: followingIds.has(id),
      followsYou: followerIds.has(id),
      authoredCount: questionCountsByUser.get(id)?.authored ?? 0,
      answeredByViewerCount: questionCountsByUser.get(id)?.answeredByViewer ?? 0,
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
          requesterName: resolveDisplayName({ displayName: user?.displayName, handle: user?.handle }),
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
          recipientName: resolveDisplayName({ displayName: user?.displayName, handle: user?.handle }),
          personalNote: request.personalNote,
          createdAt: request.createdAt,
        }
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    followPrivacy: me?.followPrivacy ?? 'approval_required',
  }
}

// The home page's quiet "Wants to connect" section reads this: the top few
// pending inbound requests plus the full pending count (so it can offer a
// "See all (N)" overflow to /friends). `top` is most-recent-first, capped at 3.
export type HomeFriendRequests = {
  top: IncomingFollowRequest[]
  totalCount: number
}

export const HOME_FRIEND_REQUESTS_LIMIT = 3

// Pure selection over the hub's already-computed incoming requests: sort
// most-recent-first, slice the cap for `top`, and keep the full pending count.
// Kept side-effect-free so it can be unit-tested without the DB.
export function selectHomeFriendRequests(
  incomingRequests: IncomingFollowRequest[],
): HomeFriendRequests {
  const top = [...incomingRequests]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, HOME_FRIEND_REQUESTS_LIMIT)
  return { top, totalCount: incomingRequests.length }
}

/**
 * Home-page view of pending inbound follow requests: the 3 most recent plus the
 * full pending count. Reuses `getFriendsHub` (which already computes
 * `incomingRequests`) rather than introducing a parallel query — the home RSC
 * only needs this slice, so it never reads the rest of the hub.
 */
export async function getHomeFriendRequests(userId: string): Promise<HomeFriendRequests> {
  const hub = await getFriendsHub(userId)
  return selectHomeFriendRequests(hub.incomingRequests)
}

/**
 * Count of pending inbound follow requests awaiting the user's approval — the
 * same set the home "Wants to connect" section and /friends surface, but as a
 * bare count. This is what the nav bell badge shows: only friend requests, not
 * the broader activity stream. Backed by the (followeeId, state) index.
 */
export async function getIncomingFollowRequestCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(follows)
    .where(and(eq(follows.followeeId, userId), eq(follows.state, 'pending')))
  return row?.value ?? 0
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

// --- B-MUTUAL-FRIEND-SUGGESTIONS-01 — friends-of-friends candidate query ---
//
// Backend only, Phase 1: this function is not called from any route or
// component yet (the surface decision -- where/how a suggestion renders --
// is still open). See _docs/A-FRIENDS-DISCOVERY-VERIFY-01-AUDIT.md claim 28
// for the prior state (no FoF candidate-enumeration query existed at all).

export type MutualFriendSuggestion = {
  id: string
  displayName: string
  mutualFriendCount: number
}

// Raw per-candidate row from the FoF group-by query: a candidate id and how
// many of the requester's direct friends are also mutual friends with them.
export type MutualFriendCandidateRow = {
  candidateId: string
  mutualFriendCount: number
}

// The candidate-side profile fields the pure composer needs: display name
// (+ phone fallback, matching the toPerson()/displayName() convention above)
// and the candidate's OWN opt-in flag -- both parties must opt in for a
// suggestion to surface (see composeMutualFriendSuggestions doc).
export type MutualFriendCandidateUserRow = {
  id: string
  displayName: string | null
  phoneNumber: string | null
  discoverableByMutualFriends: boolean
}

// Over-fetch cap for the FoF candidate scan, applied at the SQL level before
// relationship/opt-in filtering narrows the set down to `limit`. Mirrors the
// over-read-before-cap pattern used elsewhere in this codebase (e.g.
// MASTERY_SCAN_LIMIT in backfill-inviter-feed.ts) so a very well-connected
// requester's fan-out can't turn an unbounded number of candidates into an
// unbounded amount of downstream relationship/opt-in work. Generous relative
// to any realistic `limit` this phase would be called with.
const MUTUAL_SUGGESTION_CANDIDATE_SCAN_LIMIT = 200

/**
 * Pure composition for getMutualFriendSuggestions: given the requester's own
 * opt-in flag, the raw FoF candidate+count rows (already scoped in SQL to
 * the requester's direct friends' mutual follows, excluding the requester
 * and their existing direct friends), each candidate's relationship to the
 * requester, and each candidate's own profile row, produce the final
 * sorted + capped suggestion list.
 *
 * DB-free so every exclusion/ordering rule is unit-testable without a
 * database -- mirrors composeDiscoveryAttribution (src/server/feed/
 * discovery-attribution.ts) and resolve() (friend-requests.ts).
 *
 * Exclusion rule: a candidate qualifies only when the requester's
 * relationship to them is exactly 'none' (getRelationship's stranger state)
 * AND they are not blocked in either direction. 'none' transitively excludes
 * an existing friendship, a pending request in EITHER direction, and a
 * one-directional follow in either direction (following / follows_you) --
 * all of these mean the two are already connected in some way, so
 * "suggesting" the candidate as someone new would be wrong. This is a
 * superset of (but consistent with) the task's literal exclusion list
 * (existing friends, pending either direction, blocked either direction).
 *
 * Opt-in rule: BOTH sides must have discoverableByMutualFriends on --
 * requesterOptedIn gates the whole call (checked first: an opted-out
 * requester sees nothing, regardless of candidates), and each candidate's
 * own flag (on their MutualFriendCandidateUserRow) gates whether THEY can
 * be suggested to anyone. This isn't the asymmetric single-flag-gates-the-
 * exposed-party shape used by discoverableByNicheMatch/discoverableByForward
 * (see notifyNicheMatch / discovery-attribution.ts) -- both parties are
 * gating the SAME direction of exposure here (both would see each other as
 * a suggestion), so there's no asymmetric split to preserve.
 */
export function composeMutualFriendSuggestions(params: {
  requesterOptedIn: boolean
  candidateRows: MutualFriendCandidateRow[]
  relationships: Map<string, RelationshipResult>
  candidateUsers: MutualFriendCandidateUserRow[]
  limit: number
}): MutualFriendSuggestion[] {
  const { requesterOptedIn, candidateRows, relationships, candidateUsers, limit } = params
  if (!requesterOptedIn || limit <= 0) return []

  const countById = new Map(candidateRows.map((row) => [row.candidateId, row.mutualFriendCount]))
  const candidateById = new Map(candidateUsers.map((row) => [row.id, row]))

  const eligibleIds = candidateRows
    .map((row) => row.candidateId)
    .filter((id) => {
      const relationship = relationships.get(id)
      // No relationship row at all resolves to the same as an explicit
      // 'none' -- getRelationships only populates entries for ids it found
      // an edge for; an id with no edge and no block is a stranger.
      const state = relationship?.state ?? 'none'
      const blocked = relationship?.isBlocked ?? false
      if (state !== 'none' || blocked) return false

      const candidate = candidateById.get(id)
      // No profile row (e.g. deleted account) or opted-out candidate: never
      // suggested, regardless of mutual count.
      return Boolean(candidate?.discoverableByMutualFriends)
    })

  return eligibleIds
    .map((id) => {
      const candidate = candidateById.get(id)!
      return {
        id,
        displayName: displayName(candidate.displayName, candidate.phoneNumber ?? ''),
        mutualFriendCount: countById.get(id) ?? 0,
      }
    })
    .sort((a, b) => b.mutualFriendCount - a.mutualFriendCount)
    .slice(0, limit)
}

/**
 * Friends-of-friends candidate suggestions: people who share at least one
 * mutual friend with `userId` but aren't already connected to them (see
 * composeMutualFriendSuggestions for the full exclusion/opt-in rules).
 *
 * Backend only -- not called from any route or component yet. The surface
 * (where/how this renders) is a separate, still-open decision.
 *
 * Query shape: a fixed number of round-trips regardless of friend/candidate
 * count (no N+1). The FoF group-by join reuses the SAME mutual-follow join
 * shape getFriendAndFoFUserIds already uses for its "extended" (2nd-degree)
 * set -- indexed by Follow_followerId_state_idx / the unique
 * (followerId, followeeId[, state]) indexes on `follows` -- extended here to
 * tally a per-candidate mutual-friend COUNT rather than just membership.
 */
export async function getMutualFriendSuggestions(
  userId: string,
  limit: number,
): Promise<MutualFriendSuggestion[]> {
  if (limit <= 0) return []

  const [requester] = await db
    .select({ discoverableByMutualFriends: users.discoverableByMutualFriends })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const requesterOptedIn = Boolean(requester?.discoverableByMutualFriends)
  // Short-circuit before touching friends/candidates at all: an opted-out
  // requester sees nothing, so there's no reason to do any further work.
  if (!requesterOptedIn) return []

  const directFriends = await getFriends(userId)
  if (directFriends.length === 0) return []
  const directIds = directFriends.map((friend) => friend.id)

  // FoF candidates + per-candidate mutual count, in one query: for each
  // approved edge (requester's direct friend -> followee), the followee
  // qualifies as a candidate when a matching back-edge (followee -> that
  // friend, approved) exists too -- i.e. the followee is a MUTUAL friend of
  // that direct friend, not just someone they follow one-directionally.
  // Self and existing direct friends are excluded in SQL so the tally only
  // ever reflects genuine FoF candidates.
  const back = alias(follows, 'suggestion_back')
  const candidateRows: MutualFriendCandidateRow[] = await db
    .select({
      candidateId: follows.followeeId,
      mutualFriendCount: sql<number>`count(distinct ${follows.followerId})::int`.as('mutual_friend_count'),
    })
    .from(follows)
    .innerJoin(
      back,
      and(
        eq(back.followerId, follows.followeeId),
        eq(back.followeeId, follows.followerId),
        eq(back.state, 'approved'),
      ),
    )
    .where(
      and(
        eq(follows.state, 'approved'),
        inArray(follows.followerId, directIds),
        ne(follows.followeeId, userId),
        notInArray(follows.followeeId, directIds),
      ),
    )
    .groupBy(follows.followeeId)
    .orderBy(desc(sql`count(distinct ${follows.followerId})`))
    .limit(MUTUAL_SUGGESTION_CANDIDATE_SCAN_LIMIT)

  if (candidateRows.length === 0) return []
  const candidateIds = candidateRows.map((row) => row.candidateId)

  // Relationship/block exclusions and candidate profile+opt-in, batched --
  // one call each regardless of candidate count (getRelationships batches
  // internally too, see friend-requests.ts).
  const [relationships, candidateUsers] = await Promise.all([
    getRelationships(userId, candidateIds),
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        phoneNumber: users.phoneNumber,
        discoverableByMutualFriends: users.discoverableByMutualFriends,
      })
      .from(users)
      .where(inArray(users.id, candidateIds)),
  ])

  return composeMutualFriendSuggestions({
    requesterOptedIn,
    candidateRows,
    relationships,
    candidateUsers,
    limit,
  })
}
