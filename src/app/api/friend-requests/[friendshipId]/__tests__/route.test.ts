import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  acceptPendingFriendshipRequestMock,
  cancelPendingFriendshipRequestMock,
  getSessionMock,
  ignorePendingFriendshipRequestMock,
  removeFriendshipMock,
} = vi.hoisted(() => ({
  acceptPendingFriendshipRequestMock: vi.fn(),
  cancelPendingFriendshipRequestMock: vi.fn(),
  getSessionMock: vi.fn(),
  ignorePendingFriendshipRequestMock: vi.fn(),
  removeFriendshipMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/friends/friendships', () => ({
  acceptPendingFriendshipRequest: acceptPendingFriendshipRequestMock,
  cancelPendingFriendshipRequest: cancelPendingFriendshipRequestMock,
  ignorePendingFriendshipRequest: ignorePendingFriendshipRequestMock,
  removeFriendship: removeFriendshipMock,
}))

import { POST as acceptRequest } from '@/app/api/friend-requests/[friendshipId]/accept/route'
import { POST as cancelRequest } from '@/app/api/friend-requests/[friendshipId]/cancel/route'
import { POST as ignoreRequest } from '@/app/api/friend-requests/[friendshipId]/ignore/route'
import { POST as removeRequest } from '@/app/api/friend-requests/[friendshipId]/remove/route'

const context = { params: Promise.resolve({ friendshipId: 'friendship-1' }) }
const request = new Request('https://joshing.example/api/friend-requests/friendship-1/accept', { method: 'POST' })

describe('friend request action routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ userId: 'recipient-user' })
  })

  it('accept approves the pending follow through the shared helper', async () => {
    acceptPendingFriendshipRequestMock.mockResolvedValueOnce({ id: 'friendship-1', state: 'approved' })

    const response = await acceptRequest(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(acceptPendingFriendshipRequestMock).toHaveBeenCalledWith({
      friendshipId: 'friendship-1',
      userId: 'recipient-user',
    })
    expect(body.friendship).toEqual({ id: 'friendship-1', status: 'approved' })
  })

  it('ignore deletes the pending follow', async () => {
    ignorePendingFriendshipRequestMock.mockResolvedValueOnce({
      id: 'friendship-1',
      state: 'pending',
      followerId: 'requester-user',
    })

    const response = await ignoreRequest(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(ignorePendingFriendshipRequestMock).toHaveBeenCalledWith({
      friendshipId: 'friendship-1',
      userId: 'recipient-user',
    })
    expect(body.friendship).toEqual({ id: 'friendship-1', status: 'pending' })
  })

  it('cancel deletes the requester’s pending follow', async () => {
    cancelPendingFriendshipRequestMock.mockResolvedValueOnce({ id: 'friendship-1', state: 'pending' })

    const response = await cancelRequest(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(cancelPendingFriendshipRequestMock).toHaveBeenCalledWith({
      friendshipId: 'friendship-1',
      userId: 'recipient-user',
    })
    expect(body.friendship).toEqual({ id: 'friendship-1', status: 'pending' })
  })

  it('cancel returns 404 when nothing matches', async () => {
    cancelPendingFriendshipRequestMock.mockResolvedValueOnce(null)

    const response = await cancelRequest(request, context)
    expect(response.status).toBe(404)
  })

  it('remove (unfollow) deletes the viewer’s outbound follow edge', async () => {
    removeFriendshipMock.mockResolvedValueOnce({ id: 'friendship-1', state: 'approved' })

    const response = await removeRequest(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(removeFriendshipMock).toHaveBeenCalledWith({
      friendshipId: 'friendship-1',
      userId: 'recipient-user',
    })
    expect(body.friendship).toEqual({ id: 'friendship-1', status: 'approved' })
  })

  it('remove returns 404 when no follow edge matches', async () => {
    removeFriendshipMock.mockResolvedValueOnce(null)

    const response = await removeRequest(request, context)
    expect(response.status).toBe(404)
  })

  it('cancel requires auth', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await cancelRequest(request, context)
    expect(response.status).toBe(401)
  })

  it('remove requires auth', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await removeRequest(request, context)
    expect(response.status).toBe(401)
  })
})
