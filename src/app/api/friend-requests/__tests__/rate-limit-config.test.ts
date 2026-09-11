import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * F9 (2026-09-10 audit) — mirrors friends/search's rate-limit-config.test.ts:
 * the daily/weekly THRESHOLDS are read from env vars once at module load, so
 * a misconfigured value must be set before a fresh import (vi.resetModules).
 */

const { getSessionMock, getUserByIdMock, getRelationshipMock, createOrReuseMock, logTelemetryMock } =
  vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    getUserByIdMock: vi.fn(),
    getRelationshipMock: vi.fn(),
    createOrReuseMock: vi.fn(),
    logTelemetryMock: vi.fn(),
  }))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/friends/friendships', () => ({
  createOrReusePendingFriendshipRequest: createOrReuseMock,
}))
vi.mock('@/server/db/queries/friend-requests', () => ({ getRelationship: getRelationshipMock }))
vi.mock('@/server/db/queries/users', () => ({ getUserById: getUserByIdMock }))
vi.mock('@/server/telemetry', () => ({ logTelemetry: logTelemetryMock }))

function buildRequest(inviteeUserId: string) {
  return new Request('https://joshing.example/api/friend-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inviteeUserId }),
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  getSessionMock.mockResolvedValue({ userId: 'viewer-user' })
  getUserByIdMock.mockResolvedValue({ id: 'invitee-user' })
  getRelationshipMock.mockResolvedValue({ state: 'none', friendshipId: null, isBlocked: false })
  createOrReuseMock.mockResolvedValue({
    friendship: { id: 'friendship-1', state: 'pending' },
    state: 'created',
  })
  delete process.env.FRIEND_REQUEST_PER_ACCOUNT_DAILY_LIMIT
})

describe('friend-request rate limit fails closed on a misconfigured threshold', () => {
  it('falls back to the documented default (20/day) when the env var is unparseable', async () => {
    process.env.FRIEND_REQUEST_PER_ACCOUNT_DAILY_LIMIT = 'not-a-number'
    const { POST, resetFriendRequestRateLimitForTests } = await import('../route')
    resetFriendRequestRateLimitForTests()

    for (let i = 0; i < 20; i++) {
      expect((await POST(buildRequest('invitee-user'))).status).toBe(200)
    }
    // Before the fix, Number('not-a-number') -> NaN, and `count >= NaN` is
    // always false, so this 21st call would have gone through unthrottled.
    expect((await POST(buildRequest('invitee-user'))).status).toBe(429)
  })
})

describe('friend-request rate limit abuse-signal telemetry', () => {
  it('logs a coarse rate-limit reason with no identifiers when throttled', async () => {
    delete process.env.FRIEND_REQUEST_PER_ACCOUNT_DAILY_LIMIT
    const { POST, resetFriendRequestRateLimitForTests } = await import('../route')
    resetFriendRequestRateLimitForTests()

    for (let i = 0; i < 20; i++) await POST(buildRequest('invitee-user'))
    logTelemetryMock.mockClear()

    await POST(buildRequest('invitee-user'))

    expect(logTelemetryMock).toHaveBeenCalledWith('friend_request_rate_limited', {
      reason: 'daily_window',
    })
    expect(JSON.stringify(logTelemetryMock.mock.calls)).not.toContain('invitee-user')
  })
})
