import { beforeEach, describe, expect, it, vi } from 'vitest'

// getRelationship issues a single select(...).from(follows).where(...) that
// resolves to the two directional edges between viewer and target. The mock
// returns `state.rows` from that awaited chain.
const { dbMock, state } = vi.hoisted(() => {
  const state = { rows: [] as unknown[] }

  function makeChain() {
    const chain: Record<string, unknown> = {}
    for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) {
      chain[method] = vi.fn(() => chain)
    }
    chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(state.rows)
    return chain
  }

  return { dbMock: { select: vi.fn(() => makeChain()) }, state }
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
}))

import { getRelationship } from '@/server/db/queries/friend-requests'

const VIEWER = 'viewer'
const TARGET = 'target'

function outbound(stateValue: 'pending' | 'approved', approvedAt: Date | null = null) {
  return { id: 'out', followerId: VIEWER, followeeId: TARGET, state: stateValue, approvedAt }
}
function inbound(stateValue: 'pending' | 'approved', approvedAt: Date | null = null) {
  return { id: 'in', followerId: TARGET, followeeId: VIEWER, state: stateValue, approvedAt }
}

describe('getRelationship over follow edges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.rows = []
  })

  it('returns none for self', async () => {
    await expect(getRelationship(VIEWER, VIEWER)).resolves.toMatchObject({ state: 'none' })
    expect(dbMock.select).not.toHaveBeenCalled()
  })

  it('returns none when there are no edges', async () => {
    await expect(getRelationship(VIEWER, TARGET)).resolves.toMatchObject({
      state: 'none',
      friendshipId: null,
    })
  })

  it('returns friends when both directions are approved', async () => {
    const at = new Date('2026-02-01T00:00:00.000Z')
    state.rows = [outbound('approved', at), inbound('approved')]
    await expect(getRelationship(VIEWER, TARGET)).resolves.toMatchObject({
      state: 'friends',
      friendshipId: 'out',
      formedAt: at,
    })
  })

  it('returns following when only my outbound edge is approved', async () => {
    state.rows = [outbound('approved')]
    await expect(getRelationship(VIEWER, TARGET)).resolves.toMatchObject({
      state: 'following',
      friendshipId: 'out',
    })
  })

  it('returns follows_you when only their inbound edge is approved', async () => {
    state.rows = [inbound('approved')]
    await expect(getRelationship(VIEWER, TARGET)).resolves.toMatchObject({
      state: 'follows_you',
      friendshipId: null,
    })
  })

  it('returns pending_outbound when my follow awaits their approval', async () => {
    state.rows = [outbound('pending')]
    await expect(getRelationship(VIEWER, TARGET)).resolves.toMatchObject({
      state: 'pending_outbound',
      friendshipId: 'out',
    })
  })

  it('returns pending_inbound (and lets me approve) even if I already follow them', async () => {
    state.rows = [outbound('approved'), inbound('pending')]
    await expect(getRelationship(VIEWER, TARGET)).resolves.toMatchObject({
      state: 'pending_inbound',
      friendshipId: 'in',
    })
  })
})
