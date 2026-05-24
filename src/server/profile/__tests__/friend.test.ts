import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbMock, getFriendshipMock, getFriendsMock, getUserByIdMock, state } = vi.hoisted(() => {
  const state = {
    interestRows: [] as Array<{
      userId: string
      domain: string
      broadCategory: string | null
    }>,
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
    getFriendshipMock: vi.fn(),
    getFriendsMock: vi.fn(),
    getUserByIdMock: vi.fn(),
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
  getFriendship: getFriendshipMock,
  getFriends: getFriendsMock,
}))

vi.mock('@/server/db/queries/users', () => ({
  getUserById: getUserByIdMock,
}))

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
      tagline: null,
      location: null,
      bio: null,
      authorProfilePublic: true,
    })
    getFriendshipMock.mockResolvedValue({
      id: 'friendship-1',
      status: 'active',
      formedAt: new Date('2026-02-01T00:00:00.000Z'),
      requestedByUserId: 'viewer-1',
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
        tagline: null,
        location: null,
        bio: null,
        authorProfilePublic: true,
        memberSince: new Date('2026-01-01T00:00:00.000Z'),
      },
      visibility: 'friend',
      friendship: {
        id: 'friendship-1',
        status: 'active',
        formedAt: new Date('2026-02-01T00:00:00.000Z'),
        requestedByUserId: 'viewer-1',
        viewerIsRequester: true,
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
    getFriendshipMock.mockResolvedValueOnce({
      id: 'friendship-2',
      status: 'pending',
      formedAt: null,
      requestedByUserId: 'viewer-1',
    })

    const portrait = await getFriendPortraitData('stranger-1', 'viewer-1')

    expect(portrait?.visibility).toBe('stranger')
    expect(portrait?.friendship).toEqual({
      id: 'friendship-2',
      status: 'pending',
      formedAt: null,
      requestedByUserId: 'viewer-1',
      viewerIsRequester: true,
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
    getFriendshipMock.mockResolvedValueOnce(null)

    const portrait = await getFriendPortraitData('stranger-2', 'viewer-1')

    expect(portrait?.visibility).toBe('stranger')
    expect(portrait?.friendship).toBeNull()
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
})
