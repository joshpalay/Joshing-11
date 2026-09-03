import { beforeEach, describe, expect, it, vi } from 'vitest'

// Table-keyed queues: each table gets its own FIFO result queue so tests don't
// have to track cross-table call interleaving (resolveInviteLink runs its
// seed-topic and visibility lookups concurrently via Promise.all).
const { dbMock, state, users, profileDomainVisibility, getActiveDeclaredInterestsMock } =
  vi.hoisted(() => {
    const state = {
      usersQueue: [] as unknown[][],
      profileDomainVisibilityQueue: [] as unknown[][],
      updateSetCalls: [] as unknown[],
    }

    const users = { __table: 'users' }
    const profileDomainVisibility = { __table: 'profileDomainVisibility' }

    const dbMock = {
      select: vi.fn(() => {
        // `from(table)` determines which queue this call reads from; capture
        // it via a chain whose `from` remembers the table before resolving.
        let selectedTable: unknown
        const chain: Record<string, unknown> = {
          from: vi.fn((table: unknown) => {
            selectedTable = table
            return chain
          }),
          where: vi.fn(() => chain),
          limit: vi.fn(() => chain),
        }
        chain.then = (resolve: (rows: unknown[]) => unknown) => {
          const queue = selectedTable === users ? state.usersQueue : state.profileDomainVisibilityQueue
          return resolve(queue.shift() ?? [])
        }
        return chain
      }),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          state.updateSetCalls.push(values)
          return { where: vi.fn(async () => {}) }
        }),
      })),
    }

    return {
      dbMock,
      state,
      users,
      profileDomainVisibility,
      getActiveDeclaredInterestsMock: vi.fn(async () => [] as Array<{
        domain: string
        broadCategory: string | null
      }>),
    }
  })

vi.mock('@/server/db', () => ({
  db: dbMock,
  users,
  follows: {},
  profileDomainVisibility,
}))

vi.mock('@/server/db/queries/declared-interests', () => ({
  getActiveDeclaredInterests: getActiveDeclaredInterestsMock,
}))

vi.mock('@/server/feed/backfill-inviter-feed', () => ({
  backfillInviterFeedItems: vi.fn(async () => {}),
}))

vi.mock('@/server/friends/friendships', () => ({
  upsertInvitationFriendship: vi.fn(async () => {}),
}))

import {
  getCuratedInviteSeedTopics,
  getInviteLinkSeedTopics,
  resolveInviteLink,
  setCuratedInviteSeedTopics,
} from '@/server/friends/user-invite-token'

describe('getInviteLinkSeedTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.usersQueue = []
    state.profileDomainVisibilityQueue = []
    state.updateSetCalls = []
  })

  it('returns the curated set when present, without touching declared interests', async () => {
    state.usersQueue = [[{ inviteSeedInterests: [{ label: 'Sondheim' }, { label: 'Jazz' }] }]]

    const topics = await getInviteLinkSeedTopics('inviter-1')

    expect(topics.map((topic) => topic.label)).toEqual(['Sondheim', 'Jazz'])
    expect(getActiveDeclaredInterestsMock).not.toHaveBeenCalled()
  })

  it('falls back to the top 3 declared interests when nothing is curated', async () => {
    state.usersQueue = [[{ inviteSeedInterests: null }]]
    getActiveDeclaredInterestsMock.mockResolvedValueOnce([
      { domain: 'History', broadCategory: 'Humanities' },
      { domain: 'Jazz', broadCategory: 'Music' },
      { domain: 'Poetry', broadCategory: 'Literature' },
      { domain: 'Chess', broadCategory: 'Games' },
    ])

    await expect(getInviteLinkSeedTopics('inviter-2')).resolves.toEqual([
      { label: 'History', broadCategory: 'Humanities' },
      { label: 'Jazz', broadCategory: 'Music' },
      { label: 'Poetry', broadCategory: 'Literature' },
    ])
  })
})

describe('getCuratedInviteSeedTopics / setCuratedInviteSeedTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.usersQueue = []
    state.updateSetCalls = []
  })

  it('reads back only the curated labels, capped at 3', async () => {
    state.usersQueue = [
      [{ inviteSeedInterests: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }] }],
    ]

    await expect(getCuratedInviteSeedTopics('user-1')).resolves.toEqual(['A', 'B', 'C'])
  })

  it('cleans, dedupes, and caps before writing', async () => {
    await setCuratedInviteSeedTopics('user-1', ['  Jazz ', 'jazz', 'Poetry', 'Chess', 'Extra'])

    expect(state.updateSetCalls).toHaveLength(1)
    expect((state.updateSetCalls[0] as { inviteSeedInterests: unknown }).inviteSeedInterests).toEqual([
      { label: 'Jazz' },
      { label: 'Poetry' },
      { label: 'Chess' },
    ])
  })

  it('clearing to an empty array reverts to the automatic fallback', async () => {
    await setCuratedInviteSeedTopics('user-1', [])

    expect((state.updateSetCalls[0] as { inviteSeedInterests: unknown }).inviteSeedInterests).toEqual([])
  })
})

describe('resolveInviteLink — seed topics + visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.usersQueue = []
    state.profileDomainVisibilityQueue = []
  })

  function seedResolution() {
    // Main handle/token lookup.
    state.usersQueue.push([
      {
        id: 'inviter-1',
        handle: 'josh',
        displayName: 'Josh',
        avatarColor: '#fff',
        inviteToken: 'tok123',
      },
    ])
  }

  it('returns null on a token mismatch without leaking topics', async () => {
    seedResolution()

    await expect(resolveInviteLink('josh', 'wrong-token')).resolves.toBeNull()
  })

  it('includes a public topic and excludes a private one', async () => {
    seedResolution()
    // getInviteLinkSeedTopics: curated set present.
    state.usersQueue.push([
      { inviteSeedInterests: [{ label: 'Jazz' }, { label: 'Secret Hobby' }] },
    ])
    // getPubliclyHiddenDomainKeys: one row marking "Secret Hobby" private.
    state.profileDomainVisibilityQueue.push([
      {
        domain: 'Secret Hobby',
        canonicalSubcategory: 'Secret Hobby',
        visibility: 'private',
        isVisible: false,
      },
    ])

    const result = await resolveInviteLink('josh', 'tok123')

    expect(result?.seedTopics).toEqual(['Jazz'])
  })

  it('shows a topic with no PROFILE_DOMAIN_VISIBILITY row at all (default public)', async () => {
    seedResolution()
    state.usersQueue.push([{ inviteSeedInterests: [{ label: 'Jazz' }] }])
    state.profileDomainVisibilityQueue.push([]) // no rows for this user

    const result = await resolveInviteLink('josh', 'tok123')

    expect(result?.seedTopics).toEqual(['Jazz'])
  })
})
