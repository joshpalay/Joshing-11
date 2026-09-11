import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * F9 (2026-09-10 audit) — the search route's rate-limit THRESHOLDS are read
 * from env vars once at module load, so exercising a misconfigured value
 * requires setting the env var before a fresh import (vi.resetModules).
 */

const { getSessionMock, searchMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  searchMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/db/queries/friend-search', () => ({ searchFriendByHandleOrPhone: searchMock }))
vi.mock('@/server/telemetry', () => ({ logTelemetry: vi.fn() }))

function searchRequest(q: string) {
  return new Request(`https://example.com/api/friends/search?q=${encodeURIComponent(q)}`, {
    headers: { 'x-forwarded-for': '203.0.113.7' },
  })
}

beforeEach(() => {
  vi.resetModules()
  getSessionMock.mockReset()
  searchMock.mockReset()
  getSessionMock.mockResolvedValue({ userId: 'viewer-1' })
  searchMock.mockResolvedValue(null)
  delete process.env.FRIEND_SEARCH_PER_ACCOUNT_LIMIT
  delete process.env.FRIEND_SEARCH_PER_IP_LIMIT
})

afterEach(() => {
  delete process.env.FRIEND_SEARCH_PER_ACCOUNT_LIMIT
  delete process.env.FRIEND_SEARCH_PER_IP_LIMIT
})

describe('search rate limit fails closed on a misconfigured threshold', () => {
  it('falls back to the documented default (8/min) when the env var is unparseable, instead of disabling the cap', async () => {
    process.env.FRIEND_SEARCH_PER_ACCOUNT_LIMIT = 'not-a-number'
    const { GET, resetFriendSearchRateLimitForTests } = await import('../route')
    resetFriendSearchRateLimitForTests()

    for (let i = 0; i < 8; i++) {
      expect((await GET(searchRequest('@alice'))).status).toBe(200)
    }
    // Before the fix, Number('not-a-number') -> NaN, and `count >= NaN` is
    // always false, so this 9th call would have gone through unthrottled.
    const limited = await GET(searchRequest('@alice'))
    expect(limited.status).toBe(429)
  })

  it('falls back to the default when the env var is zero or negative', async () => {
    process.env.FRIEND_SEARCH_PER_ACCOUNT_LIMIT = '0'
    const { GET, resetFriendSearchRateLimitForTests } = await import('../route')
    resetFriendSearchRateLimitForTests()

    for (let i = 0; i < 8; i++) {
      expect((await GET(searchRequest('@alice'))).status).toBe(200)
    }
    expect((await GET(searchRequest('@alice'))).status).toBe(429)
  })

  it('still honors a validly configured override', async () => {
    process.env.FRIEND_SEARCH_PER_ACCOUNT_LIMIT = '2'
    const { GET, resetFriendSearchRateLimitForTests } = await import('../route')
    resetFriendSearchRateLimitForTests()

    expect((await GET(searchRequest('@alice'))).status).toBe(200)
    expect((await GET(searchRequest('@alice'))).status).toBe(200)
    expect((await GET(searchRequest('@alice'))).status).toBe(429)
  })
})

/**
 * These two tests document the KNOWN, NOT-YET-FIXED Phase-1 limitation named
 * in the F9 report (proposed there as a durable-store upgrade, not
 * implemented in this batch per the "no new infra without approval" rule).
 * They exist so a future durable-limiter change has a clear test to flip
 * from "documents the gap" to "proves the fix" — not to assert this is
 * acceptable long-term behavior.
 */
describe('known gap: the limiter is in-memory and per-instance (not yet fixed)', () => {
  it('two separate module instances (simulating two server instances) do not share a counter', async () => {
    const first = await import('../route')
    vi.resetModules()
    const second = await import('../route')
    first.resetFriendSearchRateLimitForTests()
    second.resetFriendSearchRateLimitForTests()

    for (let i = 0; i < 8; i++) {
      expect((await first.GET(searchRequest('@alice'))).status).toBe(200)
    }
    expect((await first.GET(searchRequest('@alice'))).status).toBe(429)

    // A request landing on the "other instance" has its own, unrelated
    // budget — this is the multi-instance ceiling-scales-with-instance-count
    // gap the F9 report flags for a durable (shared) store.
    expect((await second.GET(searchRequest('@alice'))).status).toBe(200)
  })

  it('a cold start (fresh module state) resets the counter entirely', async () => {
    const before = await import('../route')
    before.resetFriendSearchRateLimitForTests()
    for (let i = 0; i < 8; i++) await before.GET(searchRequest('@alice'))
    expect((await before.GET(searchRequest('@alice'))).status).toBe(429)

    vi.resetModules()
    const afterColdStart = await import('../route')
    // No resetFriendSearchRateLimitForTests() call here — a real cold start
    // has no prior state to reset. The budget is back to full.
    expect((await afterColdStart.GET(searchRequest('@alice'))).status).toBe(200)
  })
})
