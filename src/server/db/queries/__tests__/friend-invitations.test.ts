import { beforeEach, describe, expect, it, vi } from 'vitest'

// getInviterForUser issues up to three SEQUENTIAL db.select() calls (named
// invitation lookup, then — only on a miss — the user's createdAt, then the
// follow-fallback lookup). The mock queues one result array per expected call,
// consumed in call order via chain.then().
const { dbMock, state } = vi.hoisted(() => {
  const state = { queue: [] as unknown[][] }

  function makeChain() {
    const chain: Record<string, unknown> = {}
    for (const method of ['from', 'leftJoin', 'where', 'orderBy', 'limit']) {
      chain[method] = vi.fn(() => chain)
    }
    chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(state.queue.shift() ?? [])
    return chain
  }

  const dbMock = { select: vi.fn(() => makeChain()) }
  return { dbMock, state }
})

vi.mock('@/server/db', () => ({
  db: dbMock,
  follows: {
    id: 'follows.id',
    followerId: 'follows.followerId',
    followeeId: 'follows.followeeId',
    state: 'follows.state',
    approvedAt: 'follows.approvedAt',
  },
  friendInvitations: {
    id: 'friendInvitations.id',
    inviterUserId: 'friendInvitations.inviterUserId',
    inviteeUserId: 'friendInvitations.inviteeUserId',
    acceptedAt: 'friendInvitations.acceptedAt',
  },
  users: {
    id: 'users.id',
    displayName: 'users.displayName',
    createdAt: 'users.createdAt',
  },
}))

vi.mock('@/server/db/queries/friend-requests', () => ({
  getRelationships: vi.fn(async () => new Map()),
}))

import { getInviterForUser } from '@/server/db/queries/friend-invitations'

describe('getInviterForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.queue = []
  })

  it('(a) resolves via the most recently accepted FriendInvitation when one exists', async () => {
    state.queue = [[{ id: 'inv-1', inviterUserId: 'inviter-1', inviterName: 'Robyn' }]]

    await expect(getInviterForUser('invitee-1')).resolves.toEqual({
      inviterUserId: 'inviter-1',
      inviterName: 'Robyn',
      sourceId: 'inv-1',
      sourceType: 'friend_invitation',
    })
    // Named-path hit short-circuits — no createdAt or follow lookup needed.
    expect(dbMock.select).toHaveBeenCalledTimes(1)
  })

  it('(b) falls back to the earliest approved follow-in within 7 days of signup', async () => {
    state.queue = [
      [], // no FriendInvitation row
      [{ createdAt: new Date('2026-06-01T00:00:00.000Z') }], // account created
      [{ id: 'follow-1', inviterUserId: 'inviter-2', inviterName: 'Jaime' }], // follow-in edge
    ]

    await expect(getInviterForUser('invitee-2')).resolves.toEqual({
      inviterUserId: 'inviter-2',
      inviterName: 'Jaime',
      sourceId: 'follow-1',
      sourceType: 'follow',
    })
    expect(dbMock.select).toHaveBeenCalledTimes(3)
  })

  it('returns null when no FriendInvitation and no follow-in edge exists', async () => {
    state.queue = [
      [],
      [{ createdAt: new Date('2026-06-01T00:00:00.000Z') }],
      [], // no approved follower in the window
    ]

    await expect(getInviterForUser('invitee-3')).resolves.toBeNull()
  })

  it('returns null when the user does not exist', async () => {
    state.queue = [[], []] // no invitation, no user row

    await expect(getInviterForUser('ghost')).resolves.toBeNull()
    // Never reaches the follow-fallback query without a createdAt to window off.
    expect(dbMock.select).toHaveBeenCalledTimes(2)
  })
})
