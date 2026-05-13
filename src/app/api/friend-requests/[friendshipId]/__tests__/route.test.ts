import { beforeEach, describe, expect, it, vi } from 'vitest'

const { acceptPendingFriendshipRequestMock, getSessionMock, ignorePendingFriendshipRequestMock } = vi.hoisted(() => ({
  acceptPendingFriendshipRequestMock: vi.fn(),
  getSessionMock: vi.fn(),
  ignorePendingFriendshipRequestMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/friends/friendships', () => ({
  acceptPendingFriendshipRequest: acceptPendingFriendshipRequestMock,
  ignorePendingFriendshipRequest: ignorePendingFriendshipRequestMock,
}))

import { POST as acceptRequest } from '@/app/api/friend-requests/[friendshipId]/accept/route'
import { POST as ignoreRequest } from '@/app/api/friend-requests/[friendshipId]/ignore/route'

const context = { params: Promise.resolve({ friendshipId: 'friendship-1' }) }
const request = new Request('https://joshing.example/api/friend-requests/friendship-1/accept', { method: 'POST' })

describe('friend request action routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ userId: 'recipient-user' })
  })

  it('accept creates an active friendship through the shared helper', async () => {
    acceptPendingFriendshipRequestMock.mockResolvedValueOnce({ id: 'friendship-1', status: 'active' })

    const response = await acceptRequest(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(acceptPendingFriendshipRequestMock).toHaveBeenCalledWith({
      friendshipId: 'friendship-1',
      userId: 'recipient-user',
    })
    expect(body.friendship).toEqual({ id: 'friendship-1', status: 'active' })
  })

  it('ignore does not create an active friendship', async () => {
    ignorePendingFriendshipRequestMock.mockResolvedValueOnce({ id: 'friendship-1', status: 'declined' })

    const response = await ignoreRequest(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(ignorePendingFriendshipRequestMock).toHaveBeenCalledWith({
      friendshipId: 'friendship-1',
      userId: 'recipient-user',
    })
    expect(body.friendship).toEqual({ id: 'friendship-1', status: 'declined' })
  })
})
