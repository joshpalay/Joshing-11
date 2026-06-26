import { and, eq } from 'drizzle-orm'

import { softDeleteActivityByReference, writeActivity } from '@/server/activity/write-activity'
import { db, follows, users } from '@/server/db'
import {
  backfillAuthoredQuestionsFeedItems,
  backfillFollowedUserFeedItems,
} from '@/server/feed/backfill-inviter-feed'

export type Follow = typeof follows.$inferSelect

// Outcome of a follow attempt. (Kept the historical export name so the API
// routes that destructure `state` don't need to change.)
export type FriendshipRequestState =
  | 'created' // new pending request — target requires approval
  | 'auto_approved' // new approved follow — target is public
  | 'already_following' // an approved edge already exists
  | 'pending_existing' // a pending request already exists

export type FriendshipRequestContext = {
  suggestedInterests?: string[]
}

// Structural type for a Drizzle transaction/db handle that can upsert a follow.
type FollowWriter = {
  insert: (table: typeof follows) => {
    values: (values: typeof follows.$inferInsert) => {
      onConflictDoUpdate: (config: {
        target: [typeof follows.followerId, typeof follows.followeeId]
        set: Partial<typeof follows.$inferInsert>
      }) => Promise<unknown>
    }
  }
}

function requestContextForSuggestedInterests(suggestedInterests: string[]): FriendshipRequestContext | null {
  return suggestedInterests.length > 0 ? { suggestedInterests } : null
}

// Upsert a single approved follow edge. Idempotent via the (followerId,
// followeeId) unique constraint: a pending or already-approved edge settles to
// approved. This is the "back" edge that makes a follow MUTUAL — a friendship is
// bidirectional, so every friendship-forming path approves both directions.
async function ensureApprovedFollowEdge(followerId: string, followeeId: string, now: Date): Promise<void> {
  await db
    .insert(follows)
    .values({ followerId, followeeId, state: 'approved', approvedAt: now })
    .onConflictDoUpdate({
      target: [follows.followerId, follows.followeeId],
      set: { state: 'approved', approvedAt: now },
    })
}

// Seed BOTH friends' feeds with each other's recent correct answers AND public
// authored questions — what would have propagated had the mutual edge existed
// when they answered/authored. Each call is best-effort internally and cannot
// throw, so none can affect the friendship write.
async function backfillMutualFeeds(userAId: string, userBId: string): Promise<void> {
  await Promise.all([
    backfillFollowedUserFeedItems({ answererUserId: userAId, recipientUserId: userBId }),
    backfillFollowedUserFeedItems({ answererUserId: userBId, recipientUserId: userAId }),
    backfillAuthoredQuestionsFeedItems({ authorUserId: userAId, recipientUserId: userBId }),
    backfillAuthoredQuestionsFeedItems({ authorUserId: userBId, recipientUserId: userAId }),
  ])
}

// Soft-delete the "{actor} wants to be friends" activity row(s) backed by a
// follow edge that was just hard-deleted (decline/cancel). Without this the
// activity row outlives its edge and the stream keeps rendering a request the
// live source of truth (Friends Hub, profile) no longer shows. Both the live
// follow rows (referenceType 'follow') and frozen legacy friendship rows
// (referenceType 'friendship') share the same edge-id space, so clear both
// referenceTypes; build-stream also filters non-pending rows defensively.
async function cleanupFollowRequestActivity(edgeId: string): Promise<void> {
  await Promise.all([
    softDeleteActivityByReference({
      referenceType: 'follow',
      referenceId: edgeId,
      types: ['follow_request'],
    }),
    softDeleteActivityByReference({
      referenceType: 'friendship',
      referenceId: edgeId,
      types: ['friend_request'],
    }),
  ])
}

/**
 * Follow `inviteeUserId`. If the target's followPrivacy is `public` the edge is
 * approved immediately; otherwise it lands `pending` for the target to approve.
 * Reuses an existing edge (approved -> already_following, pending ->
 * pending_existing). The follower is always the requester, so there is no
 * separate requestedByUserId.
 */
export async function createOrReusePendingFriendshipRequest({
  inviterUserId,
  inviteeUserId,
  suggestedInterests = [],
  personalNote,
  now = new Date(),
}: {
  inviterUserId: string
  inviteeUserId: string
  suggestedInterests?: string[]
  personalNote?: string
  now?: Date
}): Promise<{ friendship: Follow; state: FriendshipRequestState }> {
  const followerId = inviterUserId
  const followeeId = inviteeUserId
  const requestContext = requestContextForSuggestedInterests(suggestedInterests)
  const trimmedNote = personalNote?.trim() || null

  const [existing] = await db
    .select()
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
    .limit(1)

  if (existing?.state === 'approved') {
    return { friendship: existing, state: 'already_following' }
  }
  if (existing?.state === 'pending') {
    return { friendship: existing, state: 'pending_existing' }
  }

  const [target] = await db
    .select({ followPrivacy: users.followPrivacy })
    .from(users)
    .where(eq(users.id, followeeId))
    .limit(1)
  const autoApprove = target?.followPrivacy === 'public'

  const [edge] = await db
    .insert(follows)
    .values({
      followerId,
      followeeId,
      state: autoApprove ? 'approved' : 'pending',
      approvedAt: autoApprove ? now : null,
      personalNote: trimmedNote,
      requestContext,
    })
    .returning()

  if (!edge) throw new Error('Follow could not be created')

  if (autoApprove) {
    // Public target: the request is approved immediately. A friendship is
    // bidirectional, so also approve the target's follow-back edge — adding a
    // public account makes the two MUTUAL friends, not a one-way follower.
    await ensureApprovedFollowEdge(followeeId, followerId, now)

    await Promise.all([
      // The target learns the requester added them; the requester gets the
      // matching "now connected" card.
      writeActivity({
        userId: followeeId,
        type: 'follow',
        actorUserId: followerId,
        referenceId: edge.id,
        referenceType: 'follow',
      }),
      writeActivity({
        userId: followerId,
        type: 'follow_mutual',
        actorUserId: followeeId,
        referenceId: edge.id,
        referenceType: 'follow',
      }),
    ])

    // Seed both feeds with each other's recent answers + public authored
    // questions (what would have propagated had the edge already existed).
    await backfillMutualFeeds(followerId, followeeId)
  } else {
    // approval_required target: the request lands pending. The friendship — and
    // its mutual edge, cards, and backfill — forms when the target accepts.
    await writeActivity({
      userId: followeeId,
      type: 'follow_request',
      actorUserId: followerId,
      referenceId: edge.id,
      referenceType: 'follow',
    })
  }

  return { friendship: edge, state: autoApprove ? 'auto_approved' : 'created' }
}

/**
 * Approve a pending follow request targeting `userId`. `friendshipId` is the
 * pending follow edge id.
 */
export async function acceptPendingFriendshipRequest({
  friendshipId,
  userId,
  now = new Date(),
}: {
  friendshipId: string
  userId: string
  now?: Date
}): Promise<Follow | null> {
  const [edge] = await db
    .update(follows)
    .set({ state: 'approved', approvedAt: now })
    .where(
      and(
        eq(follows.id, friendshipId),
        eq(follows.state, 'pending'),
        eq(follows.followeeId, userId),
      ),
    )
    .returning()

  if (!edge) return null

  // Mutual-accept: accepting a "wants to be friends" request makes the two
  // FRIENDS, not just a one-way follower — so approve the accepter's follow-back
  // edge too. Without this the accepter lands in a one-way `follows_you` state
  // (the profile still offers "Add friend" and the pair never become mutual).
  await ensureApprovedFollowEdge(userId, edge.followerId, now)

  // The requester learns their request was accepted; the accepter gets a
  // matching "you're now connected" card (today only the requester got one).
  await Promise.all([
    writeActivity({
      userId: edge.followerId,
      type: 'follow_approved',
      actorUserId: userId,
      referenceId: edge.id,
      referenceType: 'follow',
    }),
    writeActivity({
      userId: edge.followeeId,
      type: 'follow_mutual',
      actorUserId: edge.followerId,
      referenceId: edge.id,
      referenceType: 'follow',
    }),
    // The pending request is now resolved — the accepter gets the follow_mutual
    // card above, so the original "{actor} wants to be friends" row is stale.
    // Clear it (its edge flipped pending->approved, so build-stream would filter
    // it anyway; this also removes it at the source).
    cleanupFollowRequestActivity(edge.id),
  ])

  // Now that it's a MUTUAL follow, seed BOTH feeds. The accepter's side is the
  // fix for "I accepted but my feed didn't change" — previously only the
  // requester's feed was seeded.
  await backfillMutualFeeds(edge.followerId, edge.followeeId)

  return edge
}

/**
 * Decline a pending follow request targeting `userId` — hard-deletes the edge
 * (no terminal state). `friendshipId` is the pending follow edge id.
 */
export async function ignorePendingFriendshipRequest({
  friendshipId,
  userId,
}: {
  friendshipId: string
  userId: string
}): Promise<Follow | null> {
  const [edge] = await db
    .delete(follows)
    .where(
      and(
        eq(follows.id, friendshipId),
        eq(follows.state, 'pending'),
        eq(follows.followeeId, userId),
      ),
    )
    .returning()

  if (edge) await cleanupFollowRequestActivity(edge.id)

  return edge ?? null
}

/**
 * Cancel a pending follow request the viewer sent. `friendshipId` is the
 * pending follow edge id (`followerId = userId`).
 */
export async function cancelPendingFriendshipRequest({
  friendshipId,
  userId,
}: {
  friendshipId: string
  userId: string
}): Promise<Follow | null> {
  const [edge] = await db
    .delete(follows)
    .where(
      and(
        eq(follows.id, friendshipId),
        eq(follows.state, 'pending'),
        eq(follows.followerId, userId),
      ),
    )
    .returning()

  if (edge) await cleanupFollowRequestActivity(edge.id)

  return edge ?? null
}

/**
 * Unfollow: delete the viewer's outbound follow edge. This is directional — it
 * only removes my follow of them; their follow of me (if any) is untouched.
 * `friendshipId` is my outbound edge id.
 */
export async function removeFriendship({
  friendshipId,
  userId,
}: {
  friendshipId: string
  userId: string
}): Promise<Follow | null> {
  const [edge] = await db
    .delete(follows)
    .where(and(eq(follows.id, friendshipId), eq(follows.followerId, userId)))
    .returning()

  return edge ?? null
}

/**
 * Invitation acceptance auto-creates a mutual follow: two approved edges in
 * both directions, bypassing approval (the invite is the consent). Idempotent
 * via ON CONFLICT, so re-accepting an invitation just refreshes the edges.
 */
export async function upsertInvitationFriendship(
  writer: FollowWriter,
  {
    inviterUserId,
    inviteeUserId,
    formedAt,
  }: {
    inviterUserId: string
    inviteeUserId: string
    formedAt: Date
  },
) {
  for (const [followerId, followeeId] of [
    [inviterUserId, inviteeUserId],
    [inviteeUserId, inviterUserId],
  ] as const) {
    await writer
      .insert(follows)
      .values({
        followerId,
        followeeId,
        state: 'approved',
        approvedAt: formedAt,
        personalNote: null,
        requestContext: null,
      })
      .onConflictDoUpdate({
        target: [follows.followerId, follows.followeeId],
        set: {
          state: 'approved',
          approvedAt: formedAt,
        },
      })
  }
}
