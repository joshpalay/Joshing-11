import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  dbMock,
  getRelationshipMock,
  getFriendsMock,
  getUserByIdMock,
  areFriendsMock,
  getSectionVisibilitiesMock,
  state,
} = vi.hoisted(() => {
  const state = {
    interestRows: [] as Array<{
      userId: string
      domain: string
      broadCategory: string | null
    }>,
    sectionSettings: {
      knowledge_base: 'public',
      friends_list: 'friends',
      authored_questions: 'public',
    } as Record<string, 'public' | 'friends' | 'private'>,
  }

  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => state.interestRows),
        })),
      })),
    })),
  }

  return {
    dbMock,
    getRelationshipMock: vi.fn(),
    getFriendsMock: vi.fn(),
    getUserByIdMock: vi.fn(),
    areFriendsMock: vi.fn(async () => false),
    getSectionVisibilitiesMock: vi.fn(async () => state.sectionSettings),
    state,
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  asc: vi.fn((column) => ({ op: 'asc', column })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  declaredInterests: {
    userId: 'declaredInterests.userId',
    domain: 'declaredInterests.domain',
    broadCategory: 'declaredInterests.broadCategory',
    isActive: 'declaredInterests.isActive',
  },
}))

vi.mock('@/server/db/queries/friends', () => ({
  getFriends: getFriendsMock,
  areFriends: areFriendsMock,
}))

vi.mock('@/server/db/queries/friend-requests', () => ({
  getRelationship: getRelationshipMock,
}))

vi.mock('@/server/db/queries/users', () => ({
  getUserById: getUserByIdMock,
}))

vi.mock('@/server/profile/visibility', async () => {
  const actual = await vi.importActual<typeof import('@/server/profile/visibility')>(
    '@/server/profile/visibility'
  )
  return {
    ...actual,
    getSectionVisibilities: getSectionVisibilitiesMock,
  }
})

import { getFriendPortraitData } from '@/server/profile/friend'

describe('friend portrait data', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.interestRows = []
    getUserByIdMock.mockResolvedValue({
      id: 'friend-1',
      displayName: 'Frances Friend',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      phoneNumber: '+15550101010',
      handle: null,
    })
    getRelationshipMock.mockResolvedValue({
      state: 'friends',
      friendshipId: 'friendship-1',
      formedAt: new Date('2026-02-01T00:00:00.000Z'),
      isBlocked: false,
    })
    getFriendsMock.mockResolvedValue([])
  })

  it('returns a minimal friend portrait for active friends', async () => {
    state.interestRows = [
      { userId: 'friend-1', domain: 'Jazz piano', broadCategory: 'Music' },
      { userId: 'friend-1', domain: 'Roman roads', broadCategory: 'History' },
      { userId: 'viewer-1', domain: 'Jazz piano', broadCategory: 'Music' },
    ]

    await expect(
      getFriendPortraitData('friend-1', 'viewer-1')
    ).resolves.toEqual({
      user: {
        id: 'friend-1',
        displayName: 'Frances Friend',
        handle: null,
        memberSince: new Date('2026-01-01T00:00:00.000Z'),
      },
      visibility: 'friend',
      relationship: {
        state: 'friends',
        friendshipId: 'friendship-1',
        formedAt: new Date('2026-02-01T00:00:00.000Z'),
        isBlocked: false,
      },
      interests: [
        { domain: 'Jazz piano', broadCategory: 'Music', shared: true },
        { domain: 'Roman roads', broadCategory: 'History', shared: false },
      ],
      sharedInterests: ['Jazz piano'],
      viewerSoloInterests: [],
      friendSoloInterests: ['Roman roads'],
      mutualFriends: [],
      mutualFriendsOverflow: 0,
      isOwnerView: false,
      // Owner-only settings map is null for non-owner viewers.
      sectionSettings: null,
      // Friend can see everything (default settings, friends_list defaults
      // to 'friends' which is visible to friends).
      sectionVisibleTo: {
        knowledge_base: true,
        friends_list: true,
        authored_questions: true,
      },
      previewedAs: null,
    })
  })

  it('treats interests as overlapping when they only differ by case or punctuation', async () => {
    state.interestRows = [
      {
        userId: 'friend-1',
        domain: 'Star Trek: The Next Generation',
        broadCategory: 'Television',
      },
      { userId: 'friend-1', domain: 'Star Wars', broadCategory: 'Film' },
      {
        userId: 'viewer-1',
        domain: 'star trek the next generation',
        broadCategory: 'Television',
      },
      { userId: 'viewer-1', domain: '90s Cartoons', broadCategory: 'Television' },
    ]

    const portrait = await getFriendPortraitData('friend-1', 'viewer-1')

    expect(portrait?.sharedInterests).toEqual(['Star Trek: The Next Generation'])
    expect(portrait?.viewerSoloInterests).toEqual(['90s Cartoons'])
    expect(portrait?.friendSoloInterests).toEqual(['Star Wars'])
  })

  it('falls back to the verified phone number when a friend has no display name yet', async () => {
    getUserByIdMock.mockResolvedValueOnce({
      id: 'friend-1',
      displayName: null,
      phoneNumber: '+15550101010',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const portrait = await getFriendPortraitData('friend-1', 'viewer-1')

    expect(portrait?.user.displayName).toBe('+15550101010')
  })

  it('returns null for missing users', async () => {
    getUserByIdMock.mockResolvedValueOnce(null)
    await expect(
      getFriendPortraitData('missing-user', 'viewer-1')
    ).resolves.toBeNull()
  })

  it('returns a stranger portrait when no active friendship exists', async () => {
    getUserByIdMock.mockResolvedValueOnce({
      id: 'stranger-1',
      displayName: 'Stranger',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      phoneNumber: '+15550101011',
    })
    getRelationshipMock.mockResolvedValueOnce({
      state: 'pending_outbound',
      friendshipId: 'friendship-2',
      formedAt: null,
      isBlocked: false,
    })

    const portrait = await getFriendPortraitData('stranger-1', 'viewer-1')

    expect(portrait?.visibility).toBe('stranger')
    expect(portrait?.relationship).toEqual({
      state: 'pending_outbound',
      friendshipId: 'friendship-2',
      formedAt: null,
      isBlocked: false,
    })
    expect(portrait?.interests).toEqual([])
    expect(portrait?.sharedInterests).toEqual([])
    expect(portrait?.viewerSoloInterests).toEqual([])
    expect(portrait?.friendSoloInterests).toEqual([])
  })

  it('returns a stranger portrait with no friendship row at all', async () => {
    getUserByIdMock.mockResolvedValueOnce({
      id: 'stranger-2',
      displayName: 'Unconnected',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      phoneNumber: '+15550101012',
    })
    getRelationshipMock.mockResolvedValueOnce({
      state: 'none',
      friendshipId: null,
      formedAt: null,
      isBlocked: false,
    })

    const portrait = await getFriendPortraitData('stranger-2', 'viewer-1')

    expect(portrait?.visibility).toBe('stranger')
    expect(portrait?.relationship).toEqual({
      state: 'none',
      friendshipId: null,
      formedAt: null,
      isBlocked: false,
    })
  })

  it('returns mutual friends for non-self views', async () => {
    getFriendsMock.mockImplementation(async (userId: string) => {
      if (userId === 'viewer-1') {
        return [
          { id: 'mutual-1', displayName: 'Mona Mutual', phoneNumber: null },
          { id: 'viewer-only', displayName: 'Vera', phoneNumber: null },
        ]
      }
      if (userId === 'friend-1') {
        return [
          { id: 'mutual-1', displayName: 'Mona Mutual', phoneNumber: null },
          { id: 'friend-only', displayName: 'Fiona', phoneNumber: null },
        ]
      }
      return []
    })

    const portrait = await getFriendPortraitData('friend-1', 'viewer-1')

    expect(portrait?.mutualFriends).toEqual([
      { id: 'mutual-1', displayName: 'Mona Mutual' },
    ])
    expect(portrait?.mutualFriendsOverflow).toBe(0)
  })

  it('marks the owner view and exposes the section settings only for the owner', async () => {
    getUserByIdMock.mockResolvedValueOnce({
      id: 'viewer-1',
      displayName: 'Owner',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      phoneNumber: '+15550101000',
    })

    const portrait = await getFriendPortraitData('viewer-1', 'viewer-1')

    expect(portrait?.visibility).toBe('self')
    expect(portrait?.isOwnerView).toBe(true)
    expect(portrait?.previewedAs).toBeNull()
    expect(portrait?.sectionSettings).toEqual(state.sectionSettings)
    // Owner sees everything regardless of section settings.
    expect(portrait?.sectionVisibleTo).toEqual({
      knowledge_base: true,
      friends_list: true,
      authored_questions: true,
    })
  })

  it('hides friends-only sections from strangers via sectionVisibleTo', async () => {
    getUserByIdMock.mockResolvedValueOnce({
      id: 'stranger-3',
      displayName: 'Locked Down',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      phoneNumber: '+15550101013',
    })
    getRelationshipMock.mockResolvedValueOnce({
      state: 'none',
      friendshipId: null,
      formedAt: null,
      isBlocked: false,
    })
    // Knowledge base is friends-only; everything else is the default 'public'.
    state.sectionSettings = {
      ...state.sectionSettings,
      knowledge_base: 'friends',
      authored_questions: 'private',
    }

    const portrait = await getFriendPortraitData('stranger-3', 'viewer-1')

    expect(portrait?.visibility).toBe('stranger')
    expect(portrait?.sectionVisibleTo.knowledge_base).toBe(false)
    expect(portrait?.sectionVisibleTo.authored_questions).toBe(false)
    // friends_list defaults to 'friends' so a stranger cannot see it.
    expect(portrait?.sectionVisibleTo.friends_list).toBe(false)
  })

  it('treats friends-only sections as visible to active friends', async () => {
    state.sectionSettings = {
      ...state.sectionSettings,
      authored_questions: 'friends',
      friends_list: 'friends',
    }

    const portrait = await getFriendPortraitData('friend-1', 'viewer-1')

    expect(portrait?.visibility).toBe('friend')
    expect(portrait?.sectionVisibleTo.authored_questions).toBe(true)
    expect(portrait?.sectionVisibleTo.friends_list).toBe(true)
  })

  it('ignores previewAs from non-owner requesters', async () => {
    const portrait = await getFriendPortraitData(
      'friend-1',
      'viewer-1',
      'stranger'
    )

    expect(portrait?.previewedAs).toBeNull()
    // Viewer is a real friend so the real visibility stands.
    expect(portrait?.visibility).toBe('friend')
  })

  it('renders the owner profile as a stranger when previewing as stranger', async () => {
    getUserByIdMock.mockResolvedValueOnce({
      id: 'viewer-1',
      displayName: 'Owner',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      phoneNumber: '+15550101000',
    })
    state.sectionSettings = {
      ...state.sectionSettings,
      knowledge_base: 'friends',
      friends_list: 'friends',
      authored_questions: 'private',
    }

    const portrait = await getFriendPortraitData(
      'viewer-1',
      'viewer-1',
      'stranger'
    )

    expect(portrait?.isOwnerView).toBe(true)
    expect(portrait?.previewedAs).toBe('stranger')
    expect(portrait?.visibility).toBe('stranger')
    expect(portrait?.sectionVisibleTo.knowledge_base).toBe(false)
    expect(portrait?.sectionVisibleTo.friends_list).toBe(false)
    expect(portrait?.sectionVisibleTo.authored_questions).toBe(false)
    // Even in preview mode, the owner can still see their settings map.
    expect(portrait?.sectionSettings).toEqual(state.sectionSettings)
  })

  it('renders as friend when previewing as a specific user who is a friend of the owner', async () => {
    getUserByIdMock.mockResolvedValueOnce({
      id: 'viewer-1',
      displayName: 'Owner',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      phoneNumber: '+15550101000',
    })
    areFriendsMock.mockResolvedValueOnce(true)
    state.sectionSettings = {
      ...state.sectionSettings,
      authored_questions: 'friends',
    }

    const portrait = await getFriendPortraitData('viewer-1', 'viewer-1', {
      userId: 'specific-friend',
    })

    expect(portrait?.previewedAs).toBe('friend')
    expect(portrait?.visibility).toBe('friend')
    expect(portrait?.sectionVisibleTo.authored_questions).toBe(true)
    expect(areFriendsMock).toHaveBeenCalledWith('specific-friend', 'viewer-1')
  })

  it('falls back to stranger when previewing as a specific user who is not a friend', async () => {
    getUserByIdMock.mockResolvedValueOnce({
      id: 'viewer-1',
      displayName: 'Owner',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      phoneNumber: '+15550101000',
    })
    areFriendsMock.mockResolvedValueOnce(false)
    state.sectionSettings = {
      ...state.sectionSettings,
      authored_questions: 'friends',
    }

    const portrait = await getFriendPortraitData('viewer-1', 'viewer-1', {
      userId: 'random-user',
    })

    expect(portrait?.previewedAs).toBe('stranger')
    expect(portrait?.visibility).toBe('stranger')
    expect(portrait?.sectionVisibleTo.authored_questions).toBe(false)
  })
})
