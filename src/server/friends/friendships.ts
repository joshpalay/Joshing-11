import { friendships } from '@/server/db/schema'

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
      },
    })
}
