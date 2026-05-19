import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createOrReusePendingFriendshipRequestMock,
  getSessionMock,
  getUserByIdMock,
} = vi.hoisted(() => ({
  createOrReusePendingFriendshipRequestMock: vi.fn(),
  getSessionMock: vi.fn(),
  getUserByIdMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/friends/friendships', () => ({
  createOrReusePendingFriendshipRequest: createOrReusePendingFriendshipRequestMock,
}))

vi.mock('@/server/db/queries/users', () => ({
  getUserById: getUserByIdMock,
}))

import { POST as createFriendRequest } from '@/app/api/friend-requests/route'

function buildRequest(body: unknown) {
  return new Request('https://joshing.example/api/friend-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/friend-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ userId: 'viewer-user' })
    getUserByIdMock.mockResolvedValue({ id: 'invitee-user' })
    createOrReusePendingFriendshipRequestMock.mockResolvedValue({
      friendship: { id: 'friendship-1', status: 'pending' },
      state: 'created',
    })
  })

  it('creates a friendship request via the shared helper', async () => {
    const response = await createFriendRequest(
      buildRequest({ inviteeUserId: 'invitee-user' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(createOrReusePendingFriendshipRequestMock).toHaveBeenCalledWith({
      inviterUserId: 'viewer-user',
      inviteeUserId: 'invitee-user',
    })
    expect(body).toMatchObject({
      ok: true,
      state: 'created',
      friendship: { id: 'friendship-1', status: 'pending' },
    })
  })

  it('rejects unauthenticated callers', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await createFriendRequest(
      buildRequest({ inviteeUserId: 'invitee-user' })
    )
    expect(response.status).toBe(401)
  })

  it('rejects missing inviteeUserId', async () => {
    const response = await createFriendRequest(buildRequest({}))
    expect(response.status).toBe(400)
  })

  it('rejects self-requests', async () => {
    const response = await createFriendRequest(
      buildRequest({ inviteeUserId: 'viewer-user' })
    )
    expect(response.status).toBe(400)
  })

  it('returns 404 when the invitee does not exist', async () => {
    getUserByIdMock.mockResolvedValueOnce(null)
    const response = await createFriendRequest(
      buildRequest({ inviteeUserId: 'missing-user' })
    )
    expect(response.status).toBe(404)
  })
})
