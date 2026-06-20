import { and, eq } from 'drizzle-orm'

import { writeActivity } from '@/server/activity/write-activity'
import { db, follows, users } from '@/server/db'
import { backfillFollowedUserFeedItems } from '@/server/feed/backfill-inviter-feed'

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

  await writeActivity({
    userId: followeeId,
    type: autoApprove ? 'follow' : 'follow_request',
    actorUserId: followerId,
    referenceId: edge.id,
    referenceType: 'follow',
  })

  // Friend-add backfill: a freshly approved follow seeds the follower's feed
  // with the followee's recent activity (what would have propagated had the edge
  // already existed). Only the auto-approved (public-target) branch creates an
  // approved edge here; the pending branch backfills on approval instead. The
  // backfill is best-effort internally — it cannot throw.
  if (autoApprove) {
    await backfillFollowedUserFeedItems({
      answererUserId: followeeId,
      recipientUserId: followerId,
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

  await writeActivity({
    userId: edge.followerId,
    type: 'follow_approved',
    actorUserId: userId,
    referenceId: edge.id,
    referenceType: 'follow',
  })

  // Friend-add backfill: now that the request is approved, seed the requester's
  // (follower's) feed with the approver's (followee's) recent activity — what
  // would have propagated had the follow edge existed when they answered.
  // Best-effort internally — it cannot throw, so it can't affect the approval.
  await backfillFollowedUserFeedItems({
    answererUserId: edge.followeeId,
    recipientUserId: edge.followerId,
  })

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
