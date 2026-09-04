import { beforeEach, describe, expect, it, vi } from 'vitest'

// Table-keyed queues: each table gets its own FIFO result queue so tests don't
// have to track cross-table call interleaving (resolveInviteLink runs its
// seed-topic and visibility lookups concurrently via Promise.all).
const { dbMock, state, users, profileDomainVisibility } = vi.hoisted(() => {
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

  return { dbMock, state, users, profileDomainVisibility }
})

const { getActiveDeclaredInterestsMock, getDailyPreferencesMock } = vi.hoisted(() => ({
  getActiveDeclaredInterestsMock: vi.fn(async () => [] as Array<{ domain: string; broadCategory: string | null }>),
  getDailyPreferencesMock: vi.fn(async () => ({ domainPreferenceFrequency: {} as Record<string, string> })),
}))

const {
  findLiveInviteLinkByTokenMock,
  attributeInviteLinkJoinMock,
  getJoinedInviteLinkMock,
} = vi.hoisted(() => ({
  findLiveInviteLinkByTokenMock: vi.fn(),
  attributeInviteLinkJoinMock: vi.fn(async () => {}),
  getJoinedInviteLinkMock: vi.fn(),
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  users,
  follows: {},
  profileDomainVisibility,
}))

vi.mock('@/server/db/queries/declared-interests', () => ({
  getActiveDeclaredInterests: getActiveDeclaredInterestsMock,
}))

vi.mock('@/server/db/queries/daily-preferences', () => ({
  getDailyPreferences: getDailyPreferencesMock,
}))

vi.mock('@/server/db/queries/invite-links', () => ({
  findLiveInviteLinkByToken: findLiveInviteLinkByTokenMock,
  attributeInviteLinkJoin: attributeInviteLinkJoinMock,
  getJoinedInviteLink: getJoinedInviteLinkMock,
}))

vi.mock('@/server/feed/backfill-inviter-feed', () => ({
  backfillInviterFeedItems: vi.fn(async () => {}),
}))

vi.mock('@/server/friends/friendships', () => ({
  upsertInvitationFriendship: vi.fn(async () => {}),
}))

import {
  acceptUserInviteLink,
  getCuratedInviteSeedTopics,
  getInviteLinkSeedTopics,
  getSeedTopicsForJoinedLink,
  resolveInviteLink,
  setCuratedInviteSeedTopics,
} from '@/server/friends/user-invite-token'

function resetAll() {
  vi.clearAllMocks()
  state.usersQueue = []
  state.profileDomainVisibilityQueue = []
  state.updateSetCalls = []
  getDailyPreferencesMock.mockResolvedValue({ domainPreferenceFrequency: {} })
}

describe('getInviteLinkSeedTopics', () => {
  beforeEach(resetAll)

  it('returns the curated set when present, without touching declared interests', async () => {
    state.usersQueue = [[{ inviteSeedInterests: [{ label: 'Sondheim' }, { label: 'Jazz' }] }]]

    const topics = await getInviteLinkSeedTopics('inviter-1')

    expect(topics.map((topic) => topic.label)).toEqual(['Sondheim', 'Jazz'])
    expect(getActiveDeclaredInterestsMock).not.toHaveBeenCalled()
  })

  it('falls back to declared interests, most-played (often) first', async () => {
    state.usersQueue = [[{ inviteSeedInterests: null }]]
    getActiveDeclaredInterestsMock.mockResolvedValueOnce([
      { domain: 'History', broadCategory: 'Humanities' },
      { domain: 'Jazz', broadCategory: 'Music' },
      { domain: 'Poetry', broadCategory: 'Literature' },
      { domain: 'Chess', broadCategory: 'Games' },
    ])
    getDailyPreferencesMock.mockResolvedValueOnce({
      domainPreferenceFrequency: { Jazz: 'often', Chess: 'often' },
    })

    // Jazz and Chess are 'often' -> lead, in their original relative order;
    // then the rest (History, Poetry) in first-picked order; capped at 3.
    await expect(getInviteLinkSeedTopics('inviter-2')).resolves.toEqual([
      { label: 'Jazz', broadCategory: 'Music' },
      { label: 'Chess', broadCategory: 'Games' },
      { label: 'History', broadCategory: 'Humanities' },
    ])
  })

  it('slot 0 (or default) returns the full resolved set', async () => {
    state.usersQueue = [[{ inviteSeedInterests: [{ label: 'Sondheim' }, { label: 'Jazz' }] }]]
    await expect(getInviteLinkSeedTopics('inviter-1', 0)).resolves.toHaveLength(2)
  })

  it('a named slot (1-3) returns just the one topic at that position', async () => {
    state.usersQueue = [[{ inviteSeedInterests: [{ label: 'Sondheim' }, { label: 'Jazz' }] }]]
    await expect(getInviteLinkSeedTopics('inviter-1', 2)).resolves.toEqual([
      { label: 'Jazz', broadCategory: null, description: null },
    ])
  })

  it('a slot beyond the resolved set returns empty, not an out-of-range crash', async () => {
    state.usersQueue = [[{ inviteSeedInterests: [{ label: 'Sondheim' }] }]]
    await expect(getInviteLinkSeedTopics('inviter-1', 3)).resolves.toEqual([])
  })
})

describe('getSeedTopicsForJoinedLink', () => {
  beforeEach(resetAll)

  it('returns null when the invitee has no attributed link', async () => {
    getJoinedInviteLinkMock.mockResolvedValueOnce(null)
    await expect(getSeedTopicsForJoinedLink('invitee-1')).resolves.toBeNull()
  })

  it('resolves the specific link the invitee joined through', async () => {
    getJoinedInviteLinkMock.mockResolvedValueOnce({ inviterUserId: 'inviter-1', slot: 1 })
    state.usersQueue = [[{ inviteSeedInterests: [{ label: 'Sondheim' }, { label: 'Jazz' }] }]]

    await expect(getSeedTopicsForJoinedLink('invitee-1')).resolves.toEqual([
      { label: 'Sondheim', broadCategory: null, description: null },
    ])
  })
})

describe('getCuratedInviteSeedTopics / setCuratedInviteSeedTopics', () => {
  beforeEach(resetAll)

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

describe('resolveInviteLink — link lookup, seed topics, visibility', () => {
  beforeEach(resetAll)

  function seedHandle() {
    state.usersQueue.push([
      { id: 'inviter-1', handle: 'josh', displayName: 'Josh', avatarColor: '#fff' },
    ])
  }

  it('returns null when the handle does not resolve', async () => {
    state.usersQueue.push([])
    await expect(resolveInviteLink('nobody', 'tok123')).resolves.toBeNull()
    expect(findLiveInviteLinkByTokenMock).not.toHaveBeenCalled()
  })

  it('returns null when no live link matches the token (deleted, wrong owner, or never existed)', async () => {
    seedHandle()
    findLiveInviteLinkByTokenMock.mockResolvedValueOnce(null)

    await expect(resolveInviteLink('josh', 'wrong-token')).resolves.toBeNull()
    expect(findLiveInviteLinkByTokenMock).toHaveBeenCalledWith('inviter-1', 'wrong-token')
  })

  it('includes a public topic and excludes a private one', async () => {
    seedHandle()
    findLiveInviteLinkByTokenMock.mockResolvedValueOnce({ id: 'link-1', userId: 'inviter-1', slot: 0 })
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
    expect(result?.linkId).toBe('link-1')
    expect(result?.slot).toBe(0)
  })

  it('shows a topic with no PROFILE_DOMAIN_VISIBILITY row at all (default public)', async () => {
    seedHandle()
    findLiveInviteLinkByTokenMock.mockResolvedValueOnce({ id: 'link-1', userId: 'inviter-1', slot: 0 })
    state.usersQueue.push([{ inviteSeedInterests: [{ label: 'Jazz' }] }])
    state.profileDomainVisibilityQueue.push([]) // no rows for this user

    const result = await resolveInviteLink('josh', 'tok123')

    expect(result?.seedTopics).toEqual(['Jazz'])
  })

  it('a tagged link only carries the one topic at its slot', async () => {
    seedHandle()
    findLiveInviteLinkByTokenMock.mockResolvedValueOnce({ id: 'link-2', userId: 'inviter-1', slot: 2 })
    state.usersQueue.push([{ inviteSeedInterests: [{ label: 'Sondheim' }, { label: 'Jazz' }, { label: 'Chess' }] }])
    state.profileDomainVisibilityQueue.push([])

    const result = await resolveInviteLink('josh', 'tok-slot2')

    expect(result?.seedTopics).toEqual(['Jazz'])
  })
})

describe('acceptUserInviteLink', () => {
  beforeEach(resetAll)

  function seedHandle() {
    state.usersQueue.push([
      { id: 'inviter-1', handle: 'josh', displayName: 'Josh', avatarColor: '#fff' },
    ])
  }

  it('rejects self-invites without attributing anything', async () => {
    seedHandle()
    findLiveInviteLinkByTokenMock.mockResolvedValueOnce({ id: 'link-1', userId: 'inviter-1', slot: 0 })
    state.usersQueue.push([{ inviteSeedInterests: [] }])
    state.profileDomainVisibilityQueue.push([])

    const result = await acceptUserInviteLink({ handle: 'josh', token: 'tok123', inviteeUserId: 'inviter-1' })

    expect(result).toEqual({ accepted: false })
    expect(attributeInviteLinkJoinMock).not.toHaveBeenCalled()
  })

  it('accepts and attributes the join to the specific link clicked', async () => {
    seedHandle()
    findLiveInviteLinkByTokenMock.mockResolvedValueOnce({ id: 'link-1', userId: 'inviter-1', slot: 1 })
    state.usersQueue.push([{ inviteSeedInterests: [{ label: 'Sondheim' }] }])
    state.profileDomainVisibilityQueue.push([])

    const result = await acceptUserInviteLink({ handle: 'josh', token: 'tok123', inviteeUserId: 'invitee-1' })

    expect(result).toEqual({ accepted: true })
    expect(attributeInviteLinkJoinMock).toHaveBeenCalledWith('invitee-1', 'link-1')
  })

  it('a failed attribution never undoes an otherwise-successful accept', async () => {
    seedHandle()
    findLiveInviteLinkByTokenMock.mockResolvedValueOnce({ id: 'link-1', userId: 'inviter-1', slot: 0 })
    state.usersQueue.push([{ inviteSeedInterests: [] }])
    state.profileDomainVisibilityQueue.push([])
    attributeInviteLinkJoinMock.mockRejectedValueOnce(new Error('boom'))

    const result = await acceptUserInviteLink({ handle: 'josh', token: 'tok123', inviteeUserId: 'invitee-1' })

    expect(result).toEqual({ accepted: true })
  })
})
