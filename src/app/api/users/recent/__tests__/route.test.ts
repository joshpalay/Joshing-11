import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, getRecentDirectSendRecipientsMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getRecentDirectSendRecipientsMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/db/queries/friends', () => ({
  getRecentDirectSendRecipients: getRecentDirectSendRecipientsMock,
}))

import { GET } from '@/app/api/users/recent/route'

// F8 (2026-09-10 audit) — same phone-fallback defect as GET /api/users.
describe('GET /api/users/recent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ userId: 'me' })
  })

  it('rejects unauthenticated callers', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const response = await GET()
    expect(response.status).toBe(401)
    expect(getRecentDirectSendRecipientsMock).not.toHaveBeenCalled()
  })

  it('never serializes a phone number in the response body', async () => {
    getRecentDirectSendRecipientsMock.mockResolvedValueOnce([
      { id: 'f1', displayName: null, handle: 'nameless', phoneNumber: '+15550202020' },
    ])

    const response = await GET()
    const body = await response.json()

    expect(JSON.stringify(body)).not.toContain('+1555')
    expect(body).toEqual([{ id: 'f1', displayName: '@nameless' }])
  })
})
