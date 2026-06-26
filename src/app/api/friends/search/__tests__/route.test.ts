import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, searchMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  searchMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/db/queries/friend-search', () => ({
  searchFriendByHandleOrPhone: searchMock,
}))

import { GET, resetFriendSearchRateLimitForTests } from '../route'

function searchRequest(q: string, ip = '203.0.113.7') {
  return new Request(`https://example.com/api/friends/search?q=${encodeURIComponent(q)}`, {
    headers: { 'x-forwarded-for': ip },
  })
}

describe('GET /api/friends/search rate limiting', () => {
  beforeEach(() => {
    resetFriendSearchRateLimitForTests()
    getSessionMock.mockReset()
    searchMock.mockReset()
    getSessionMock.mockResolvedValue({ userId: 'viewer-1' })
    searchMock.mockResolvedValue(null)
    delete process.env.FRIEND_SEARCH_THROTTLE_DISABLED
  })

  it('returns 401 without a session before consuming any budget', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const res = await GET(searchRequest('@alice'))
    expect(res.status).toBe(401)
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('allows up to the per-account limit, then 429s with Retry-After', async () => {
    for (let i = 0; i < 8; i++) {
      const res = await GET(searchRequest('@alice'))
      expect(res.status).toBe(200)
    }
    expect(searchMock).toHaveBeenCalledTimes(8)

    const limited = await GET(searchRequest('@alice'))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    const body = await limited.json()
    expect(body).toEqual({ error: 'rate_limited', reason: 'account_window' })
    // The blocked call did not reach the query.
    expect(searchMock).toHaveBeenCalledTimes(8)
  })

  it('does not consume budget on invalid input', async () => {
    // Empty q fails validation -> { match: null } without recording an attempt.
    for (let i = 0; i < 20; i++) {
      const res = await GET(searchRequest(''))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ match: null })
    }
    // A valid query still goes through afterward.
    const res = await GET(searchRequest('@alice'))
    expect(res.status).toBe(200)
    expect(searchMock).toHaveBeenCalledTimes(1)
  })

  it('per-IP limit catches account rotation behind one address', async () => {
    // Rotate the account on every call so the per-account cap never trips;
    // the shared IP should still hit the per-IP ceiling (40/min).
    for (let i = 0; i < 40; i++) {
      getSessionMock.mockResolvedValueOnce({ userId: `rotating-${i}` })
      const res = await GET(searchRequest('@alice', '198.51.100.42'))
      expect(res.status).toBe(200)
    }
    getSessionMock.mockResolvedValueOnce({ userId: 'rotating-41' })
    const limited = await GET(searchRequest('@alice', '198.51.100.42'))
    expect(limited.status).toBe(429)
    expect((await limited.json()).reason).toBe('ip_window')
  })

  it('honors the throttle-disable escape hatch', async () => {
    process.env.FRIEND_SEARCH_THROTTLE_DISABLED = '1'
    for (let i = 0; i < 50; i++) {
      const res = await GET(searchRequest('@alice'))
      expect(res.status).toBe(200)
    }
    expect(searchMock).toHaveBeenCalledTimes(50)
  })
})
