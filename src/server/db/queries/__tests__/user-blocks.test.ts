import { beforeEach, describe, expect, it, vi } from 'vitest'

// B-FRIENDS-SAFETY-01 Phase 1 — persistent blocking. These tests lock the
// two behaviors the Done-When criteria call out explicitly:
//  1. blockUser tears down BOTH follows edges of an existing mutual pair (a
//     block is a hard boundary — an approved mutual follow must not survive
//     it) and cleans up the matching follow-request activity per edge.
//  2. isBlockedBetween / blockedIdsAmong are direction-agnostic: either party
//     having blocked the other is enough.

const { dbMock, state, userBlocksTable, followsTable, usersTable, cleanupMock } = vi.hoisted(() => {
  const userBlocksTable = { id: 'userBlocks.id', blockerId: 'userBlocks.blockerId', blockedId: 'userBlocks.blockedId', createdAt: 'userBlocks.createdAt' }
  const followsTable = { id: 'follows.id', followerId: 'follows.followerId', followeeId: 'follows.followeeId' }
  const usersTable = { id: 'users.id', handle: 'users.handle', displayName: 'users.displayName', avatarColor: 'users.avatarColor' }

  const state = {
    deletedFollowEdges: [] as Array<{ id: string }>,
    selectResult: [] as unknown[],
  }

  function chain(result: unknown) {
    const obj: Record<string, unknown> = {
      from: vi.fn(() => obj),
      innerJoin: vi.fn(() => obj),
      where: vi.fn(() => obj),
      orderBy: vi.fn(() => obj),
      limit: vi.fn(async () => result),
      then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
        Promise.resolve(result).then(resolve, reject),
    }
    return obj
  }

  const cleanupMock = vi.fn(async () => undefined)

  const dbMock = {
    select: vi.fn(() => chain(state.selectResult)),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => undefined) })),
    })),
    delete: vi.fn((table: unknown) => {
      if (table === userBlocksTable) {
        return { where: vi.fn(async () => undefined) }
      }
      return { where: vi.fn(() => ({ returning: vi.fn(async () => state.deletedFollowEdges) })) }
    }),
  }

  return { dbMock, state, userBlocksTable, followsTable, usersTable, cleanupMock }
})

vi.mock('@/server/db', () => ({
  db: dbMock,
  userBlocks: userBlocksTable,
  follows: followsTable,
  users: usersTable,
}))

vi.mock('@/server/friends/friendships', () => ({
  cleanupFollowRequestActivity: cleanupMock,
}))

import {
  blockedIdsAmong,
  blockUser,
  isBlockedBetween,
  listBlockedUsers,
  unblockUser,
} from '@/server/db/queries/user-blocks'

const ALICE = 'user-alice'
const BOB = 'user-bob'

beforeEach(() => {
  state.deletedFollowEdges = []
  state.selectResult = []
  dbMock.insert.mockClear()
  dbMock.delete.mockClear()
  dbMock.select.mockClear()
  cleanupMock.mockClear()
})

describe('blockUser', () => {
  it('deletes BOTH follows edges of an existing mutual pair and cleans up activity for each', async () => {
    // A mutual follow is two rows: alice->bob and bob->alice. Both must go.
    state.deletedFollowEdges = [{ id: 'edge-alice-bob' }, { id: 'edge-bob-alice' }]

    await blockUser(ALICE, BOB)

    expect(dbMock.insert).toHaveBeenCalledTimes(1)
    expect(dbMock.delete).toHaveBeenCalledWith(followsTable)
    expect(cleanupMock).toHaveBeenCalledTimes(2)
    expect(cleanupMock).toHaveBeenCalledWith('edge-alice-bob')
    expect(cleanupMock).toHaveBeenCalledWith('edge-bob-alice')
  })

  it('is a no-op on cleanup when there was no existing follow edge', async () => {
    state.deletedFollowEdges = []

    await blockUser(ALICE, BOB)

    expect(cleanupMock).not.toHaveBeenCalled()
  })
})

describe('unblockUser', () => {
  it('deletes the UserBlock row and does not touch follows', async () => {
    await unblockUser(ALICE, BOB)

    expect(dbMock.delete).toHaveBeenCalledWith(userBlocksTable)
    expect(dbMock.delete).not.toHaveBeenCalledWith(followsTable)
  })
})

describe('isBlockedBetween', () => {
  it('is true when the CALLER is the blocker', async () => {
    state.selectResult = [{ id: 'block-1' }]
    expect(await isBlockedBetween(ALICE, BOB)).toBe(true)
  })

  it('is true when the CALLER is the blocked party (direction-agnostic)', async () => {
    state.selectResult = [{ id: 'block-1' }]
    expect(await isBlockedBetween(BOB, ALICE)).toBe(true)
  })

  it('is false when no block row exists in either direction', async () => {
    state.selectResult = []
    expect(await isBlockedBetween(ALICE, BOB)).toBe(false)
  })
})

describe('blockedIdsAmong', () => {
  it('returns candidate ids blocked in either direction', async () => {
    state.selectResult = [
      { blockerId: ALICE, blockedId: BOB }, // alice blocked bob
      { blockerId: 'user-carl', blockedId: ALICE }, // carl blocked alice
    ]
    const result = await blockedIdsAmong(ALICE, [BOB, 'user-carl', 'user-dan'])
    expect(result).toEqual(new Set([BOB, 'user-carl']))
  })

  it('returns an empty set for an empty candidate list without querying', async () => {
    const result = await blockedIdsAmong(ALICE, [])
    expect(result.size).toBe(0)
    expect(dbMock.select).not.toHaveBeenCalled()
  })
})

describe('listBlockedUsers', () => {
  it('returns the joined rows for people the caller blocked', async () => {
    state.selectResult = [
      { id: BOB, handle: 'bob', displayName: 'Bob', avatarColor: '#fff', blockedAt: new Date('2026-09-01') },
    ]
    const result = await listBlockedUsers(ALICE)
    expect(result).toEqual(state.selectResult)
  })
})
