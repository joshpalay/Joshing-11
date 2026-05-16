import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, refreshSessionInvitationClaimMock } = vi.hoisted(
  () => ({
    getSessionMock: vi.fn(),
    refreshSessionInvitationClaimMock: vi.fn(),
  }),
)

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
  refreshSessionInvitationClaim: refreshSessionInvitationClaimMock,
}))

import { GET } from '@/app/api/auth/refresh-session/route'

function makeRequest(query = '') {
  return new Request(`http://localhost/api/auth/refresh-session${query}`, {
    method: 'GET',
  })
}

describe('GET /api/auth/refresh-session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockReset()
    refreshSessionInvitationClaimMock.mockReset()
  })

  it('redirects to /login when there is no session', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const res = await GET(makeRequest('?next=/feed'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/login$/)
  })

  it('re-signs the session and redirects to the next path for any valid session', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    refreshSessionInvitationClaimMock.mockResolvedValueOnce(true)
    const res = await GET(makeRequest('?next=/knowledge'))
    expect(refreshSessionInvitationClaimMock).toHaveBeenCalled()
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/knowledge')
  })

  it('rejects open-redirect attempts via the next param', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    refreshSessionInvitationClaimMock.mockResolvedValueOnce(true)
    const res = await GET(makeRequest('?next=//evil.example.com/steal'))
    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    // Should land on root, not on the attacker host.
    expect(location).not.toContain('evil.example.com')
    expect(location).toMatch(/localhost\/$/)
  })

  it('rejects absolute-URL next params', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    refreshSessionInvitationClaimMock.mockResolvedValueOnce(true)
    const res = await GET(makeRequest('?next=https://evil.example.com'))
    const location = res.headers.get('location') ?? ''
    expect(location).not.toContain('evil.example.com')
  })

  it('bounces to /login when refresh helper fails (cookie disappeared)', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    refreshSessionInvitationClaimMock.mockResolvedValueOnce(false)
    const res = await GET(makeRequest('?next=/feed'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/login$/)
  })

  it('defaults to / when next param is missing', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    refreshSessionInvitationClaimMock.mockResolvedValueOnce(true)
    const res = await GET(makeRequest())
    expect(res.headers.get('location')).toMatch(/localhost\/$/)
  })
})
