import { and, eq, ne, or } from 'drizzle-orm'

import { writeActivity } from '@/server/activity/write-activity'
import { db, friendships } from '@/server/db'

export type FriendshipRequestState =
  | 'created'
  | 'already_friends'
  | 'pending_existing'
  | 'reverse_pending'
  | 'reopened'

export type FriendshipRequestContext = {
  suggestedInterests?: string[]
}

type FriendshipWriter = {
  insert: (table: typeof friendships) => {
    values: (values: typeof friendships.$inferInsert) => {
      onConflictDoUpdate: (config: {
        target: [typeof friendships.userAId, typeof friendships.userBId]
        set: Partial<typeof friendships.$inferInsert>
      }) => Promise<unknown>
    }
  }
}

export function friendshipPair(a: string, b: string) {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a }
}


function requestContextForSuggestedInterests(suggestedInterests: string[]): FriendshipRequestContext | null {
  return suggestedInterests.length > 0 ? { suggestedInterests } : null
}

export async function createOrReusePendingFriendshipRequest({
  inviterUserId,
  inviteeUserId,
  suggestedInterests = [],
}: {
  inviterUserId: string
  inviteeUserId: string
  suggestedInterests?: string[]
}): Promise<{ friendship: typeof friendships.$inferSelect; state: FriendshipRequestState }> {
  const pair = friendshipPair(inviterUserId, inviteeUserId)
  const requestContext = requestContextForSuggestedInterests(suggestedInterests)

  const [existingFriendship] = await db
    .select()
    .from(friendships)
    .where(and(eq(friendships.userAId, pair.userAId), eq(friendships.userBId, pair.userBId)))
    .limit(1)

  if (existingFriendship?.status === 'active') {
    return { friendship: existingFriendship, state: 'already_friends' }
  }

  if (existingFriendship?.status === 'pending') {
    return {
      friendship: existingFriendship,
      state: existingFriendship.requestedByUserId === inviterUserId ? 'pending_existing' : 'reverse_pending',
    }
  }

  if (existingFriendship) {
    const [reopenedFriendship] = await db
      .update(friendships)
      .set({
        status: 'pending',
        requestedByUserId: inviterUserId,
        formedVia: 'direct_request',
        formedAt: null,
        removedAt: null,
        removedByUserId: null,
        requestContext,
      })
      .where(eq(friendships.id, existingFriendship.id))
      .returning()

    if (!reopenedFriendship) throw new Error('Friendship request could not be reopened')

    await writeActivity({
      userId: inviteeUserId,
      type: 'friend_request',
      actorUserId: inviterUserId,
      referenceId: reopenedFriendship.id,
      referenceType: 'friendship',
    })

    return { friendship: reopenedFriendship, state: 'reopened' }
  }

  const [friendship] = await db
    .insert(friendships)
    .values({
      ...pair,
      status: 'pending',
      requestedByUserId: inviterUserId,
      formedVia: 'direct_request',
      formedAt: null,
      removedAt: null,
      removedByUserId: null,
      requestContext,
    })
    .returning()

  if (!friendship) throw new Error('Friendship request could not be created')

  await writeActivity({
    userId: inviteeUserId,
    type: 'friend_request',
    actorUserId: inviterUserId,
    referenceId: friendship.id,
    referenceType: 'friendship',
  })

  return { friendship, state: 'created' }
}

export async function acceptPendingFriendshipRequest({
  friendshipId,
  userId,
  now = new Date(),
}: {
  friendshipId: string
  userId: string
  now?: Date
}): Promise<typeof friendships.$inferSelect | null> {
  const [friendship] = await db
    .update(friendships)
    .set({
      status: 'active',
      formedAt: now,
      removedAt: null,
      removedByUserId: null,
    })
    .where(
      and(
        eq(friendships.id, friendshipId),
        eq(friendships.status, 'pending'),
        ne(friendships.requestedByUserId, userId),
        or(eq(friendships.userAId, userId), eq(friendships.userBId, userId))
      )
    )
    .returning()

  if (!friendship) return null

  await writeActivity({
    userId: friendship.requestedByUserId,
    type: 'friend_request_accepted',
    actorUserId: userId,
    referenceId: friendship.id,
    referenceType: 'friendship',
  })

  return friendship
}

export async function ignorePendingFriendshipRequest({
  friendshipId,
  userId,
  now = new Date(),
}: {
  friendshipId: string
  userId: string
  now?: Date
}): Promise<typeof friendships.$inferSelect | null> {
  const [friendship] = await db
    .update(friendships)
    .set({
      status: 'declined',
      removedAt: now,
      removedByUserId: userId,
    })
    .where(
      and(
        eq(friendships.id, friendshipId),
        eq(friendships.status, 'pending'),
        ne(friendships.requestedByUserId, userId),
        or(eq(friendships.userAId, userId), eq(friendships.userBId, userId))
      )
    )
    .returning()

  return friendship ?? null
}

export async function upsertInvitationFriendship(
  writer: FriendshipWriter,
  {
    inviterUserId,
    inviteeUserId,
    formedAt,
  }: {
    inviterUserId: string
    inviteeUserId: string
    formedAt: Date
  }
) {
  const pair = friendshipPair(inviterUserId, inviteeUserId)

  await writer
    .insert(friendships)
    .values({
      ...pair,
      status: 'active',
      requestedByUserId: inviterUserId,
      formedVia: 'invitation',
      formedAt,
      removedAt: null,
      removedByUserId: null,
      requestContext: null,
    })
    .onConflictDoUpdate({
      target: [friendships.userAId, friendships.userBId],
      set: {
        status: 'active',
        requestedByUserId: inviterUserId,
        formedVia: 'invitation',
        formedAt,
        removedAt: null,
        removedByUserId: null,
        requestContext: null,
      },
    })
}
