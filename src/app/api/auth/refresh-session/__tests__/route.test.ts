import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  destroySessionMock,
  getSessionMock,
  hasAcceptedInvitationForUserMock,
  refreshSessionInvitationClaimMock,
} = vi.hoisted(() => ({
  destroySessionMock: vi.fn(async () => undefined),
  getSessionMock: vi.fn(),
  hasAcceptedInvitationForUserMock: vi.fn(),
  refreshSessionInvitationClaimMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  destroySession: destroySessionMock,
  getSession: getSessionMock,
  refreshSessionInvitationClaim: refreshSessionInvitationClaimMock,
}))

vi.mock('@/server/friends/invitations', () => ({
  hasAcceptedInvitationForUser: hasAcceptedInvitationForUserMock,
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
    hasAcceptedInvitationForUserMock.mockReset()
    refreshSessionInvitationClaimMock.mockReset()
    destroySessionMock.mockReset()
    destroySessionMock.mockResolvedValue(undefined)
  })

  it('redirects to /login when there is no session', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const res = await GET(makeRequest('?next=/feed'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/login$/)
  })

  it('destroys session and bounces to /login?reason=no_invitation when user has no accepted invitation', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    hasAcceptedInvitationForUserMock.mockResolvedValueOnce(false)
    const res = await GET(makeRequest('?next=/feed'))
    expect(destroySessionMock).toHaveBeenCalled()
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain(
      '/login?reason=no_invitation',
    )
  })

  it('re-signs the session and redirects to the next path when invitation is accepted', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    hasAcceptedInvitationForUserMock.mockResolvedValueOnce(true)
    refreshSessionInvitationClaimMock.mockResolvedValueOnce(true)
    const res = await GET(makeRequest('?next=/knowledge'))
    expect(refreshSessionInvitationClaimMock).toHaveBeenCalled()
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/knowledge')
  })

  it('rejects open-redirect attempts via the next param', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    hasAcceptedInvitationForUserMock.mockResolvedValueOnce(true)
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
    hasAcceptedInvitationForUserMock.mockResolvedValueOnce(true)
    refreshSessionInvitationClaimMock.mockResolvedValueOnce(true)
    const res = await GET(makeRequest('?next=https://evil.example.com'))
    const location = res.headers.get('location') ?? ''
    expect(location).not.toContain('evil.example.com')
  })

  it('bounces to /login when refresh helper fails (cookie disappeared)', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    hasAcceptedInvitationForUserMock.mockResolvedValueOnce(true)
    refreshSessionInvitationClaimMock.mockResolvedValueOnce(false)
    const res = await GET(makeRequest('?next=/feed'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/login$/)
  })

  it('defaults to / when next param is missing', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    hasAcceptedInvitationForUserMock.mockResolvedValueOnce(true)
    refreshSessionInvitationClaimMock.mockResolvedValueOnce(true)
    const res = await GET(makeRequest())
    expect(res.headers.get('location')).toMatch(/localhost\/$/)
  })
})
