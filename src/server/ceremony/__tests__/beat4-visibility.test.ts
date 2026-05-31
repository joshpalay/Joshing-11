/**
 * F3.4: Beat 4 (Alignment) must respect each friend's
 * profileDomainVisibility setting. A friend who marked a domain as 'private'
 * should not have that domain leak into another viewer's alignment beat,
 * even if both have points there.
 *
 * This test exercises the in-memory filter logic by mocking the DB chain.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Shape of one row produced by the LEFT JOIN of playerMastery + users +
// profileDomainVisibility.
type Row = {
  userId: string
  displayName: string | null
  domain: string
  visibility: 'public' | 'friends' | 'private' | null
}

// All state used by the (hoisted) vi.mock factories must itself be hoisted.
const { getFriendsMock, masteryRowsState, dbMock } = vi.hoisted(() => {
  const masteryRowsState: { rows: unknown[] } = { rows: [] }

  // Universal chainable db mock. The test drives the full computeBeats(), which
  // runs all five beats + two friend fallbacks + countActiveAnsweringPlayers —
  // each using different builder chains (.where().orderBy(), .innerJoin().where(),
  // .leftJoin().where(), plain .where(inArray(...)), …). Rather than hand-roll
  // every shape, db.select()/db.selectDistinct() each start a fresh chain whose
  // builder methods all return the SAME proxy, and the proxy is awaitable. The
  // terminal value is chosen by discriminator so only beat4 gets real rows:
  //   - selectDistinct chain  → both friends active
  //   - any chain using leftJoin (the alignment join) → masteryRowsState.rows
  //   - everything else → [] (so beats 1/2/3/5 produce no output, no throws)
  function makeChain(isSelectDistinct: boolean) {
    const flags = { selectDistinct: isSelectDistinct, leftJoin: false }
    const resolve = (): unknown[] => {
      if (flags.selectDistinct) return [{ userId: 'friend-a' }, { userId: 'friend-b' }]
      if (flags.leftJoin) return masteryRowsState.rows
      return []
    }
    const proxy: Record<PropertyKey, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (onFulfilled: (value: unknown[]) => unknown) => Promise.resolve(resolve()).then(onFulfilled)
          }
          return (..._args: unknown[]) => {
            if (prop === 'leftJoin') flags.leftJoin = true
            return proxy
          }
        },
      },
    )
    return proxy
  }

  const dbMock = {
    select: () => makeChain(false),
    selectDistinct: () => makeChain(true),
  }
  return { getFriendsMock: vi.fn(), masteryRowsState, dbMock }
})

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
