import { beforeEach, describe, expect, it, vi } from 'vitest'

// B-FRIENDS-SAFETY-01 Phase 1 — locks the wiring between the shared
// relationship resolver and the block table: resolve() itself stays pure
// (always isBlocked: false), and getRelationship / getRelationships
// override it with a real lookup AFTER resolve() runs, without changing the
// resolved `state`.

const { dbMock, state, isBlockedBetweenMock, blockedIdsAmongMock } = vi.hoisted(() => {
  const state = {
    followRows: [] as Array<{ id: string; followerId: string; followeeId: string; state: string; approvedAt: Date | null }>,
    isBlocked: false,
    blockedIds: new Set<string>(),
  }

  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => state.followRows),
      })),
    })),
  }

  const isBlockedBetweenMock = vi.fn(async () => state.isBlocked)
  const blockedIdsAmongMock = vi.fn(async () => state.blockedIds)

  return { dbMock, state, isBlockedBetweenMock, blockedIdsAmongMock }
})

vi.mock('@/server/db', () => ({
  db: dbMock,
  follows: { id: 'follows.id', followerId: 'follows.followerId', followeeId: 'follows.followeeId', state: 'follows.state', approvedAt: 'follows.approvedAt' },
}))

vi.mock('@/server/db/queries/user-blocks', () => ({
  isBlockedBetween: isBlockedBetweenMock,
  blockedIdsAmong: blockedIdsAmongMock,
}))

import { getRelationship, getRelationships } from '@/server/db/queries/friend-requests'

const VIEWER = 'viewer-1'
const TARGET = 'target-1'

beforeEach(() => {
  state.followRows = []
  state.isBlocked = false
  state.blockedIds = new Set()
  isBlockedBetweenMock.mockClear()
  blockedIdsAmongMock.mockClear()
})

describe('getRelationship', () => {
  it('reports isBlocked: true for a blocked pair with NO follow edge (state stays none)', async () => {
    state.followRows = []
    state.isBlocked = true

    const result = await getRelationship(VIEWER, TARGET)

    expect(result.state).toBe('none')
    expect(result.isBlocked).toBe(true)
    expect(isBlockedBetweenMock).toHaveBeenCalledWith(VIEWER, TARGET)
  })

  it('reports isBlocked: false when there is no block, independent of state', async () => {
    state.followRows = [
      { id: 'edge-1', followerId: VIEWER, followeeId: TARGET, state: 'approved', approvedAt: new Date() },
    ]
    state.isBlocked = false

    const result = await getRelationship(VIEWER, TARGET)

    expect(result.state).toBe('following')
    expect(result.isBlocked).toBe(false)
  })
})

describe('getRelationships', () => {
  it('marks only the blocked target ids as isBlocked: true', async () => {
    state.followRows = []
    state.blockedIds = new Set(['blocked-user'])

    const result = await getRelationships(VIEWER, ['blocked-user', 'clean-user'])

    expect(result.get('blocked-user')?.isBlocked).toBe(true)
    expect(result.get('clean-user')?.isBlocked).toBe(false)
  })

  it('returns an empty map without querying blockedIdsAmong for an empty target list', async () => {
    const result = await getRelationships(VIEWER, [])
    expect(result.size).toBe(0)
    expect(blockedIdsAmongMock).not.toHaveBeenCalled()
  })
})
