import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, searchMock, logTelemetryMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  searchMock: vi.fn(),
  logTelemetryMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/db/queries/friend-search', () => ({
  searchFriendByHandleOrPhone: searchMock,
}))

vi.mock('@/server/telemetry', () => ({
  logTelemetry: logTelemetryMock,
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
    logTelemetryMock.mockReset()
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

// F9 (2026-09-10 audit) — the durable, privacy-preserving abuse signal:
// counts, coarse buckets, and outcome only. Never the query string, never a
// resolved identifier.
describe('GET /api/friends/search abuse-signal telemetry', () => {
  beforeEach(() => {
    resetFriendSearchRateLimitForTests()
    getSessionMock.mockReset()
    searchMock.mockReset()
    logTelemetryMock.mockReset()
    getSessionMock.mockResolvedValue({ userId: 'viewer-1' })
    delete process.env.FRIEND_SEARCH_THROTTLE_DISABLED
  })

  it('logs outcome only on a match, never the query or the matched identity', async () => {
    searchMock.mockResolvedValueOnce({ id: 'friend-1', handle: 'alice', displayName: 'Alice' })
    await GET(searchRequest('@alice'))

    expect(logTelemetryMock).toHaveBeenCalledWith('friend_search_performed', { outcome: 'match' })
    const loggedText = JSON.stringify(logTelemetryMock.mock.calls)
    expect(loggedText).not.toContain('alice')
    expect(loggedText).not.toContain('friend-1')
  })

  it('logs outcome only on no match', async () => {
    searchMock.mockResolvedValueOnce(null)
    await GET(searchRequest('4155551234'))

    expect(logTelemetryMock).toHaveBeenCalledWith('friend_search_performed', { outcome: 'no_match' })
    expect(JSON.stringify(logTelemetryMock.mock.calls)).not.toContain('4155551234')
  })

  it('logs a coarse rate-limit reason with no identifiers when throttled', async () => {
    for (let i = 0; i < 8; i++) await GET(searchRequest('@alice'))
    logTelemetryMock.mockClear()

    await GET(searchRequest('@alice'))

    expect(logTelemetryMock).toHaveBeenCalledWith('friend_search_rate_limited', {
      reason: 'account_window',
    })
    expect(JSON.stringify(logTelemetryMock.mock.calls)).not.toContain('alice')
  })

  it('does not log anything for invalid input (never ran a lookup)', async () => {
    await GET(searchRequest(''))
    expect(logTelemetryMock).not.toHaveBeenCalled()
  })
})
