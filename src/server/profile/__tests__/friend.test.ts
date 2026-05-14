import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbMock, getFriendshipMock, getUserByIdMock, state } = vi.hoisted(() => {
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
    })
    getFriendshipMock.mockResolvedValue({
      id: 'friendship-1',
      status: 'active',
      formedAt: new Date('2026-02-01T00:00:00.000Z'),
    })
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
        memberSince: new Date('2026-01-01T00:00:00.000Z'),
      },
      visibility: 'friend',
      friendship: {
        id: 'friendship-1',
        formedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      interests: [
        { domain: 'Jazz piano', broadCategory: 'Music', shared: true },
        { domain: 'Roman roads', broadCategory: 'History', shared: false },
      ],
      sharedInterests: ['Jazz piano'],
    })
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

  it('returns null for missing users and non-active friendships', async () => {
    getUserByIdMock.mockResolvedValueOnce(null)
    await expect(
      getFriendPortraitData('missing-user', 'viewer-1')
    ).resolves.toBeNull()

    getUserByIdMock.mockResolvedValueOnce({
      id: 'stranger-1',
      displayName: 'Stranger',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      phoneNumber: '+15550101011',
    })
    getFriendshipMock.mockResolvedValueOnce({
      id: 'friendship-2',
      status: 'pending',
    })

    await expect(
      getFriendPortraitData('stranger-1', 'viewer-1')
    ).resolves.toBeNull()
  })
})
