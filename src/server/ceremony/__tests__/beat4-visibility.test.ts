/**
 * F3.4: Beat 4 (Alignment) must respect each friend's
 * profileDomainVisibility setting. A friend who marked a domain as 'private'
 * should not have that domain leak into another viewer's alignment beat,
 * even if both have points there.
 *
 * This test exercises the in-memory filter logic by mocking the DB chain.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getFriendsMock } = vi.hoisted(() => ({
  getFriendsMock: vi.fn(),
}))

// Shape of one row produced by the LEFT JOIN of playerMastery + users +
// profileDomainVisibility.
type Row = {
  userId: string
  displayName: string | null
  domain: string
  visibility: 'public' | 'friends' | 'private' | null
}

const masteryRowsState: { rows: Row[] } = { rows: [] }

const dbMock = {
  select: vi.fn(() => ({
    from: () => ({
      innerJoin: () => ({
        leftJoin: () => ({
          where: vi.fn(async () => masteryRowsState.rows),
        }),
      }),
    }),
  })),
}

vi.mock('@/server/db/queries/friends', () => ({
  getFriends: getFriendsMock,
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  declaredInterests: {},
  feedItems: {},
  joshingGameResponses: {},
  masteryEvents: {},
  playerMastery: {
    userId: 'pm.userId',
    canonicalSubcategory: 'pm.cs',
    totalPoints: 'pm.tp',
  },
  profileDomainVisibility: {
    userId: 'pdv.userId',
    canonicalSubcategory: 'pdv.cs',
    visibility: 'pdv.vis',
  },
  questions: {},
  users: { id: 'u.id', displayName: 'u.dn' },
}))

import { computeBeats } from '@/server/ceremony/compute-beats'

const CYCLE_START = new Date('2026-05-01T00:00:00Z')
const CYCLE_END = new Date('2026-05-15T00:00:00Z')

async function runBeat4(rows: Row[]) {
  masteryRowsState.rows = rows
  const payload = await computeBeats('viewer-1', CYCLE_START, CYCLE_END)
  return payload.beat4
}

describe('Beat 4 Alignment respects profileDomainVisibility (F3.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getFriendsMock.mockResolvedValue([{ id: 'friend-a' }, { id: 'friend-b' }])
    masteryRowsState.rows = []
  })

  it('includes a friend domain when visibility is public (or missing)', async () => {
    const result = await runBeat4([
      { userId: 'viewer-1', displayName: 'Viewer', domain: 'jazz', visibility: null },
      { userId: 'friend-a', displayName: 'Alice', domain: 'jazz', visibility: 'public' },
    ])
    expect(result).toEqual({
      userId: 'friend-a',
      displayName: 'Alice',
      sharedDomains: ['jazz'],
    })
  })

  it('includes a friend domain when visibility is friends-only', async () => {
    const result = await runBeat4([
      { userId: 'viewer-1', displayName: 'Viewer', domain: 'jazz', visibility: null },
      { userId: 'friend-a', displayName: 'Alice', domain: 'jazz', visibility: 'friends' },
    ])
    expect(result?.sharedDomains).toEqual(['jazz'])
  })

  it("EXCLUDES a friend's private domain from the alignment beat", async () => {
    const result = await runBeat4([
      { userId: 'viewer-1', displayName: 'Viewer', domain: 'jazz', visibility: null },
      { userId: 'friend-a', displayName: 'Alice', domain: 'jazz', visibility: 'private' },
    ])
    expect(result).toBeNull()
  })

  it('mixed visibility: includes public domains, excludes private ones from the same friend', async () => {
    const result = await runBeat4([
      { userId: 'viewer-1', displayName: 'Viewer', domain: 'jazz', visibility: null },
      { userId: 'viewer-1', displayName: 'Viewer', domain: 'poetry', visibility: null },
      { userId: 'friend-a', displayName: 'Alice', domain: 'jazz', visibility: 'public' },
      { userId: 'friend-a', displayName: 'Alice', domain: 'poetry', visibility: 'private' },
    ])
    expect(result?.sharedDomains).toEqual(['jazz'])
  })

  it("viewer's own private domains DO still count in their portrait (only friend rows are filtered)", async () => {
    const result = await runBeat4([
      // Viewer has private knowledge in 'jazz' — still counts for matching.
      { userId: 'viewer-1', displayName: 'Viewer', domain: 'jazz', visibility: 'private' },
      { userId: 'friend-a', displayName: 'Alice', domain: 'jazz', visibility: 'public' },
    ])
    expect(result?.sharedDomains).toEqual(['jazz'])
  })
})
