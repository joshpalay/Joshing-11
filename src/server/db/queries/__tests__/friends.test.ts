import { beforeEach, describe, expect, it, vi } from 'vitest'

// The follow helpers issue joined queries (select(...).from(follows)
// [.innerJoin(...)]* .where(...) [.orderBy(...)]). The mock returns a single
// chainable, awaitable object whose methods all return itself and which
// resolves to `state.rows` when awaited or after .orderBy(). Each test sets
// `state.rows` to the rows the query under test should yield.
const { dbMock, state } = vi.hoisted(() => {
  const state = { rows: [] as unknown[] }

  function makeChain() {
    const chain: Record<string, unknown> = {}
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'groupBy']) {
      chain[method] = vi.fn(() => chain)
    }
    chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(state.rows)
    return chain
  }

  const dbMock = { select: vi.fn(() => makeChain()) }
  return { dbMock, state }
})

const { blockedIdsAmongMock, isBlockedBetweenMock } = vi.hoisted(() => ({
  blockedIdsAmongMock: vi.fn(async () => new Set<string>()),
  isBlockedBetweenMock: vi.fn(async () => false),
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  declaredInterests: { userId: 'di.userId', domain: 'di.domain', isActive: 'di.isActive' },
  feedItems: {},
  follows: {
    id: 'follows.id',
    followerId: 'follows.followerId',
    followeeId: 'follows.followeeId',
    state: 'follows.state',
    approvedAt: 'follows.approvedAt',
  },
  joshingGameResponses: {},
  masteryEvents: {},
  users: { id: 'users.id', phoneNumber: 'users.phoneNumber', displayName: 'users.displayName' },
}))

vi.mock('@/server/feed/visibility', () => ({ DIRECT_SENT_FEED_SOURCE_TYPE: 'direct_sent' }))
vi.mock('@/server/db/queries/user-blocks', () => ({
  blockedIdsAmong: blockedIdsAmongMock,
  isBlockedBetween: isBlockedBetweenMock,
}))

import { areFriends, getFollowers, getFollowing, getFriends, getMutualFollows } from '@/server/db/queries/friends'

describe('follow query helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.rows = []
    blockedIdsAmongMock.mockResolvedValue(new Set())
    isBlockedBetweenMock.mockResolvedValue(false)
  })

  it('getFollowing returns the users I follow (approved outbound)', async () => {
    state.rows = [{ user: { id: 'user-josh', displayName: 'Josh', phoneNumber: '+1734' } }]
    await expect(getFollowing('user-jaime')).resolves.toEqual([
      expect.objectContaining({ id: 'user-josh', displayName: 'Josh' }),
    ])
  })

  it('getFollowers returns the users who follow me (approved inbound)', async () => {
    state.rows = [{ user: { id: 'user-robyn', displayName: 'Robyn', phoneNumber: '+1313' } }]
    await expect(getFollowers('user-jaime')).resolves.toEqual([
      expect.objectContaining({ id: 'user-robyn', displayName: 'Robyn' }),
    ])
  })

  it('getMutualFollows / getFriends return the mutual (both-approved) set', async () => {
    state.rows = [{ user: { id: 'user-josh', displayName: 'Josh', phoneNumber: '+1734' } }]
    await expect(getMutualFollows('user-jaime')).resolves.toEqual([
      expect.objectContaining({ id: 'user-josh' }),
    ])

    state.rows = [{ user: { id: 'user-josh', displayName: 'Josh', phoneNumber: '+1734' } }]
    await expect(getFriends('user-jaime')).resolves.toEqual([
      expect.objectContaining({ id: 'user-josh' }),
    ])
  })

  it('excludes a blocked user even when stale approved edges remain', async () => {
    state.rows = [{ user: { id: 'user-josh', displayName: 'Josh', phoneNumber: '+1734' } }]
    blockedIdsAmongMock.mockResolvedValueOnce(new Set(['user-josh']))

    await expect(getFriends('user-jaime')).resolves.toEqual([])
  })

  it('areFriends is true only when both directional approved edges exist', async () => {
    state.rows = [
      { followerId: 'a', followeeId: 'b' },
      { followerId: 'b', followeeId: 'a' },
    ]
    await expect(areFriends('a', 'b')).resolves.toBe(true)

    state.rows = [{ followerId: 'a', followeeId: 'b' }]
    await expect(areFriends('a', 'b')).resolves.toBe(false)
  })

  it('areFriends is false for self', async () => {
    await expect(areFriends('a', 'a')).resolves.toBe(false)
    expect(dbMock.select).not.toHaveBeenCalled()
  })

  it('areFriends is false when either side has blocked the other', async () => {
    state.rows = [
      { followerId: 'a', followeeId: 'b' },
      { followerId: 'b', followeeId: 'a' },
    ]
    isBlockedBetweenMock.mockResolvedValueOnce(true)

    await expect(areFriends('a', 'b')).resolves.toBe(false)
  })
})
