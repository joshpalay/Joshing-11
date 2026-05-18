import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  getUserOnboardingProfileMock,
  refreshSessionOnboardingClaimMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getUserOnboardingProfileMock: vi.fn(),
  refreshSessionOnboardingClaimMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
  refreshSessionOnboardingClaim: refreshSessionOnboardingClaimMock,
}))

vi.mock('@/server/db/queries/users', () => ({
  getUserOnboardingProfile: getUserOnboardingProfileMock,
}))

import { GET } from '@/app/api/auth/refresh-onboarding-claim/route'

function makeRequest(query = '') {
  return new Request(
    `http://localhost/api/auth/refresh-onboarding-claim${query}`,
    { method: 'GET' },
  )
}

describe('GET /api/auth/refresh-onboarding-claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockReset()
    getUserOnboardingProfileMock.mockReset()
    refreshSessionOnboardingClaimMock.mockReset()
  })

  it('redirects to /login when there is no session', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const res = await GET(makeRequest('?next=/knowledge'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/login$/)
    expect(refreshSessionOnboardingClaimMock).not.toHaveBeenCalled()
  })

  it('redirects to /login when the user row is missing', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce(null)
    const res = await GET(makeRequest('?next=/knowledge'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/login$/)
    expect(refreshSessionOnboardingClaimMock).not.toHaveBeenCalled()
  })

  it('redirects to /onboarding when the user has not finished onboarding', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: false,
    })
    const res = await GET(makeRequest('?next=/knowledge'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/onboarding$/)
    expect(refreshSessionOnboardingClaimMock).not.toHaveBeenCalled()
  })

  it('re-mints the session and redirects to next when the user has finished onboarding', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: true,
    })
    refreshSessionOnboardingClaimMock.mockResolvedValueOnce(true)
    const res = await GET(makeRequest('?next=/knowledge'))
    expect(refreshSessionOnboardingClaimMock).toHaveBeenCalled()
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/knowledge')
  })

  it('bounces to /login when refresh helper fails (cookie disappeared)', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: true,
    })
    refreshSessionOnboardingClaimMock.mockResolvedValueOnce(false)
    const res = await GET(makeRequest('?next=/knowledge'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/login$/)
  })

  it('rejects open-redirect attempts via the next param', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: true,
    })
    refreshSessionOnboardingClaimMock.mockResolvedValueOnce(true)
    const res = await GET(makeRequest('?next=//evil.example.com/steal'))
    const location = res.headers.get('location') ?? ''
    expect(location).not.toContain('evil.example.com')
    expect(location).toMatch(/localhost\/$/)
  })

  it('rejects absolute-URL next params', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: true,
    })
    refreshSessionOnboardingClaimMock.mockResolvedValueOnce(true)
    const res = await GET(makeRequest('?next=https://evil.example.com'))
    const location = res.headers.get('location') ?? ''
    expect(location).not.toContain('evil.example.com')
  })

  it('defaults to / when next param is missing', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' })
    getUserOnboardingProfileMock.mockResolvedValueOnce({
      id: 'u1',
      onboardingComplete: true,
    })
    refreshSessionOnboardingClaimMock.mockResolvedValueOnce(true)
    const res = await GET(makeRequest())
    expect(res.headers.get('location')).toMatch(/localhost\/$/)
  })
})
