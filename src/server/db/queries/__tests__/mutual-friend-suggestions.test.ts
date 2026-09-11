import { beforeEach, describe, expect, it, vi } from 'vitest'

// B-MUTUAL-FRIEND-SUGGESTIONS-01 Phase 1. Two layers, mirroring the split
// used elsewhere in this codebase (composeDiscoveryAttribution / resolve()):
//   - composeMutualFriendSuggestions is pure -- exercised directly below with
//     no mocking, covering every exclusion/ordering rule against a handful of
//     seeded fake users.
//   - getMutualFriendSuggestions is the thin DB-orchestration wrapper --
//     exercised with a sequential db mock to confirm it's wired correctly
//     (right short-circuits, right query order, results actually flow
//     through the pure composer).
//
// vi.mock calls stay at module top level (not nested inside a describe), per
// this repo's existing convention (see friends.test.ts / friend-requests.test.ts)
// -- Vitest only reliably hoists mocks declared here.

const { dbMock, state, getRelationshipsMock } = vi.hoisted(() => {
  const state = {
    // Queued in call order: [0] requester flag row, [1] getFriends rows
    // (via getMutualFollows), [2] FoF candidate group-by rows,
    // [3] candidateUsers rows.
    selectQueue: [] as unknown[][],
  }

  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'groupBy']) {
      chain[method] = vi.fn(() => chain)
    }
    chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(rows)
    return chain
  }

  const dbMock = {
    select: vi.fn(() => makeChain(state.selectQueue.shift() ?? [])),
  }

  const getRelationshipsMock = vi.fn(async () => new Map())

  return { dbMock, state, getRelationshipsMock }
})

vi.mock('@/server/db', () => ({
  db: dbMock,
  declaredInterests: {},
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
  questions: {},
  users: {
    id: 'users.id',
    handle: 'users.handle',
    displayName: 'users.displayName',
    discoverableByMutualFriends: 'users.discoverableByMutualFriends',
  },
}))
vi.mock('@/server/db/queries/friend-requests', () => ({ getRelationships: getRelationshipsMock }))
vi.mock('@/server/feed/visibility', () => ({ DIRECT_SENT_FEED_SOURCE_TYPE: 'direct_sent' }))

import {
  composeMutualFriendSuggestions,
  getMutualFriendSuggestions,
} from '@/server/db/queries/friends'

describe('composeMutualFriendSuggestions', () => {
  // Three seeded candidates sharing 1-3 mutual friends with the requester,
  // all clean (no relationship, no block, opted in) unless a test overrides.
  const baseCandidateRows = [
    { candidateId: 'low', mutualFriendCount: 1 },
    { candidateId: 'high', mutualFriendCount: 3 },
    { candidateId: 'mid', mutualFriendCount: 2 },
  ]
  const baseCandidateUsers = [
    { id: 'low', displayName: 'Low Mutual', handle: 'low', discoverableByMutualFriends: true },
    { id: 'high', displayName: 'High Mutual', handle: 'high', discoverableByMutualFriends: true },
    { id: 'mid', displayName: 'Mid Mutual', handle: 'mid', discoverableByMutualFriends: true },
  ]
  const noRelationships = new Map<string, { state: string; isBlocked: boolean; friendshipId: null; formedAt: null }>()

  it('(a) returns empty when the REQUESTER has opted out, regardless of candidates', () => {
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: false,
      candidateRows: baseCandidateRows,
      relationships: noRelationships,
      candidateUsers: baseCandidateUsers,
      limit: 10,
    })
    expect(result).toEqual([])
  })

  it('(b) never surfaces a candidate whose OWN opt-in flag is off', () => {
    const candidateUsers = baseCandidateUsers.map((u) =>
      u.id === 'high' ? { ...u, discoverableByMutualFriends: false } : u,
    )
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: baseCandidateRows,
      relationships: noRelationships,
      candidateUsers,
      limit: 10,
    })
    expect(result.map((r) => r.id)).not.toContain('high')
    expect(result.map((r) => r.id).sort()).toEqual(['low', 'mid'])
  })

  it('(b) never surfaces a candidate missing a profile row entirely (e.g. deleted account)', () => {
    const candidateUsers = baseCandidateUsers.filter((u) => u.id !== 'high')
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: baseCandidateRows,
      relationships: noRelationships,
      candidateUsers,
      limit: 10,
    })
    expect(result.map((r) => r.id)).not.toContain('high')
  })

  it('(c) excludes a candidate who is already a friend (state: friends)', () => {
    const relationships = new Map(noRelationships)
    relationships.set('high', { state: 'friends', isBlocked: false, friendshipId: 'edge-1', formedAt: new Date() })
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: baseCandidateRows,
      relationships,
      candidateUsers: baseCandidateUsers,
      limit: 10,
    })
    expect(result.map((r) => r.id)).not.toContain('high')
  })

  it('(c) excludes a candidate with a pending request in EITHER direction', () => {
    const relationships = new Map(noRelationships)
    relationships.set('high', { state: 'pending_outbound', isBlocked: false, friendshipId: 'edge-1', formedAt: null })
    relationships.set('mid', { state: 'pending_inbound', isBlocked: false, friendshipId: 'edge-2', formedAt: null })
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: baseCandidateRows,
      relationships,
      candidateUsers: baseCandidateUsers,
      limit: 10,
    })
    expect(result.map((r) => r.id)).not.toContain('high')
    expect(result.map((r) => r.id)).not.toContain('mid')
  })

  it('(c) excludes a candidate with a one-directional follow in either direction', () => {
    const relationships = new Map(noRelationships)
    relationships.set('high', { state: 'following', isBlocked: false, friendshipId: 'edge-1', formedAt: new Date() })
    relationships.set('mid', { state: 'follows_you', isBlocked: false, friendshipId: null, formedAt: null })
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: baseCandidateRows,
      relationships,
      candidateUsers: baseCandidateUsers,
      limit: 10,
    })
    expect(result.map((r) => r.id)).toEqual(['low'])
  })

  it('(c) excludes a blocked candidate even when the follow state is "none"', () => {
    const relationships = new Map(noRelationships)
    relationships.set('high', { state: 'none', isBlocked: true, friendshipId: null, formedAt: null })
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: baseCandidateRows,
      relationships,
      candidateUsers: baseCandidateUsers,
      limit: 10,
    })
    expect(result.map((r) => r.id)).not.toContain('high')
  })

  it('(c) treats a candidate with NO relationship row at all as a clean stranger', () => {
    // relationships map has no entry for any of these ids -- getRelationships
    // only populates entries it found an edge for.
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: baseCandidateRows,
      relationships: new Map(),
      candidateUsers: baseCandidateUsers,
      limit: 10,
    })
    expect(result.map((r) => r.id).sort()).toEqual(['high', 'low', 'mid'])
  })

  it('(d) sorts by mutual-friend count descending', () => {
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: baseCandidateRows,
      relationships: noRelationships,
      candidateUsers: baseCandidateUsers,
      limit: 10,
    })
    expect(result.map((r) => r.id)).toEqual(['high', 'mid', 'low'])
    expect(result.map((r) => r.mutualFriendCount)).toEqual([3, 2, 1])
  })

  it('(d) caps at `limit` after sorting, keeping the highest counts', () => {
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: baseCandidateRows,
      relationships: noRelationships,
      candidateUsers: baseCandidateUsers,
      limit: 2,
    })
    expect(result.map((r) => r.id)).toEqual(['high', 'mid'])
  })

  // F8: a suggestion shows one user's name to a stranger, so the fallback chain
  // is display name -> @username -> a neutral generic. The phone number is not
  // in that chain at any step. This test previously asserted the opposite —
  // that a nameless candidate surfaced as their raw phone number — which is the
  // leak F8 closed everywhere else.
  it('falls back to @username when displayName is null', () => {
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: [{ candidateId: 'anon', mutualFriendCount: 1 }],
      relationships: new Map(),
      candidateUsers: [{ id: 'anon', displayName: null, handle: 'anon_user', discoverableByMutualFriends: true }],
      limit: 10,
    })
    expect(result[0]?.displayName).toBe('@anon_user')
  })

  it('falls back to a neutral generic when there is no name and no username', () => {
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: [{ candidateId: 'anon', mutualFriendCount: 1 }],
      relationships: new Map(),
      candidateUsers: [{ id: 'anon', displayName: null, handle: null, discoverableByMutualFriends: true }],
      limit: 10,
    })
    expect(result[0]?.displayName).toBe('Joshing friend')
  })

  it('never surfaces anything phone-shaped for a nameless candidate', () => {
    // Regression guard for the leak itself, independent of the exact fallback
    // wording: whatever we render, it must not look like a phone number.
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: [{ candidateId: 'anon', mutualFriendCount: 1 }],
      relationships: new Map(),
      candidateUsers: [{ id: 'anon', displayName: null, handle: null, discoverableByMutualFriends: true }],
      limit: 10,
    })
    expect(result[0]?.displayName).not.toMatch(/\+?\d{7,}/)
  })

  it('a minimum of 1 shared friend qualifies (no higher floor)', () => {
    const result = composeMutualFriendSuggestions({
      requesterOptedIn: true,
      candidateRows: [{ candidateId: 'low', mutualFriendCount: 1 }],
      relationships: new Map(),
      candidateUsers: [baseCandidateUsers[0]!],
      limit: 10,
    })
    expect(result.map((r) => r.id)).toEqual(['low'])
  })
})

describe('getMutualFriendSuggestions (DB wiring)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.selectQueue = []
    getRelationshipsMock.mockClear()
    getRelationshipsMock.mockResolvedValue(new Map())
  })

  it('short-circuits on an opted-out requester without querying friends or candidates', async () => {
    state.selectQueue = [[{ discoverableByMutualFriends: false }]]

    const result = await getMutualFriendSuggestions('requester-1', 10)

    expect(result).toEqual([])
    // Only the requester-flag select ran.
    expect(dbMock.select).toHaveBeenCalledTimes(1)
    expect(getRelationshipsMock).not.toHaveBeenCalled()
  })

  it('short-circuits when the requester has no direct friends', async () => {
    state.selectQueue = [
      [{ discoverableByMutualFriends: true }], // requester opted in
      [], // getFriends -> no mutual follows
    ]

    const result = await getMutualFriendSuggestions('requester-1', 10)

    expect(result).toEqual([])
    expect(dbMock.select).toHaveBeenCalledTimes(2)
    expect(getRelationshipsMock).not.toHaveBeenCalled()
  })

  it('returns [] immediately for limit <= 0 without touching the DB', async () => {
    const result = await getMutualFriendSuggestions('requester-1', 0)
    expect(result).toEqual([])
    expect(dbMock.select).not.toHaveBeenCalled()
  })

  it('wires a full happy path through to composeMutualFriendSuggestions correctly', async () => {
    state.selectQueue = [
      [{ discoverableByMutualFriends: true }], // requester opted in
      [{ user: { id: 'friend-a', displayName: 'Friend A', phoneNumber: '+1' } }], // getFriends
      [
        { candidateId: 'cand-low', mutualFriendCount: 1 },
        { candidateId: 'cand-high', mutualFriendCount: 2 },
      ], // FoF candidate group-by
      [
        { id: 'cand-low', displayName: 'Cand Low', handle: 'cand_low', discoverableByMutualFriends: true },
        { id: 'cand-high', displayName: 'Cand High', handle: 'cand_high', discoverableByMutualFriends: true },
      ], // candidateUsers
    ]

    const result = await getMutualFriendSuggestions('requester-1', 10)

    expect(getRelationshipsMock).toHaveBeenCalledWith('requester-1', ['cand-low', 'cand-high'])
    expect(result).toEqual([
      { id: 'cand-high', displayName: 'Cand High', mutualFriendCount: 2 },
      { id: 'cand-low', displayName: 'Cand Low', mutualFriendCount: 1 },
    ])
  })

  it('short-circuits after the FoF query when there are zero candidates', async () => {
    state.selectQueue = [
      [{ discoverableByMutualFriends: true }],
      [{ user: { id: 'friend-a', displayName: 'Friend A', phoneNumber: '+1' } }],
      [], // no FoF candidates at all
    ]

    const result = await getMutualFriendSuggestions('requester-1', 10)

    expect(result).toEqual([])
    expect(getRelationshipsMock).not.toHaveBeenCalled()
    // requester flag + getFriends + FoF query = 3; the candidateUsers query
    // never fires.
    expect(dbMock.select).toHaveBeenCalledTimes(3)
  })
})
