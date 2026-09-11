import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, getFriendsMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getFriendsMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/db/queries/friends', () => ({ getFriends: getFriendsMock }))

import { GET } from '@/app/api/users/route'

// F8 (2026-09-10 audit) — this route used to fall back to the raw phone
// number as displayName for a friend with no display name set yet, which
// put that phone number straight into the JSON response body.
describe('GET /api/users', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ userId: 'me' })
  })

  it('rejects unauthenticated callers', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await GET()
    expect(response.status).toBe(401)
    expect(getFriendsMock).not.toHaveBeenCalled()
  })

  it('never serializes a phone number in the response body', async () => {
    getFriendsMock.mockResolvedValueOnce([
      { id: 'f1', displayName: 'Robyn', handle: 'robyn', phoneNumber: '+15550101010' },
      { id: 'f2', displayName: null, handle: 'nameless', phoneNumber: '+15550202020' },
      { id: 'f3', displayName: null, handle: null, phoneNumber: '+15550303030' },
    ])

    const response = await GET()
    const body = await response.json()
    const raw = JSON.stringify(body)

    expect(raw).not.toContain('+1555')
    expect(body).toEqual([
      { id: 'f1', displayName: 'Robyn' },
      { id: 'f2', displayName: '@nameless' },
      { id: 'f3', displayName: 'Joshing friend' },
    ])
  })
})
