import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createOrReusePendingFriendshipRequestMock,
  getRelationshipMock,
  getSessionMock,
  getUserByIdMock,
} = vi.hoisted(() => ({
  createOrReusePendingFriendshipRequestMock: vi.fn(),
  getRelationshipMock: vi.fn(),
  getSessionMock: vi.fn(),
  getUserByIdMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/friends/friendships', () => ({
  createOrReusePendingFriendshipRequest: createOrReusePendingFriendshipRequestMock,
}))

// The route pre-checks the existing relationship before creating a request.
// Mock it directly so the real getRelationship (which hits db + friendshipPair)
// doesn't run; default to "no relationship" so the happy path proceeds.
vi.mock('@/server/db/queries/friend-requests', () => ({
  getRelationship: getRelationshipMock,
}))

vi.mock('@/server/db/queries/users', () => ({
  getUserById: getUserByIdMock,
}))

import { POST as createFriendRequest, resetFriendRequestRateLimitForTests } from '@/app/api/friend-requests/route'

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
    resetFriendRequestRateLimitForTests()
    delete process.env.FRIEND_REQUEST_THROTTLE_DISABLED
    getSessionMock.mockResolvedValue({ userId: 'viewer-user' })
    getUserByIdMock.mockResolvedValue({ id: 'invitee-user' })
    getRelationshipMock.mockResolvedValue({ state: 'none', friendshipId: null, isBlocked: false })
    createOrReusePendingFriendshipRequestMock.mockResolvedValue({
      friendship: { id: 'friendship-1', state: 'pending' },
      state: 'created',
    })
  })

  it('creates a follow request via the shared helper', async () => {
    const response = await createFriendRequest(
      buildRequest({ inviteeUserId: 'invitee-user' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(createOrReusePendingFriendshipRequestMock).toHaveBeenCalledWith(
      // The route also threads personalNote and a `now` Date; assert the
      // identifying fields rather than an exact object (now is non-deterministic).
      expect.objectContaining({
        inviterUserId: 'viewer-user',
        inviteeUserId: 'invitee-user',
      })
    )
    expect(body).toMatchObject({
      ok: true,
      state: 'created',
      friendship: { id: 'friendship-1', status: 'pending' },
    })
  })

  it('blocks a follow when already following', async () => {
    getRelationshipMock.mockResolvedValueOnce({ state: 'following', friendshipId: 'f1', isBlocked: false })
    const response = await createFriendRequest(buildRequest({ inviteeUserId: 'invitee-user' }))
    expect(response.status).toBe(409)
    expect(createOrReusePendingFriendshipRequestMock).not.toHaveBeenCalled()
  })

  it('allows a follow-back when they already follow me', async () => {
    getRelationshipMock.mockResolvedValueOnce({ state: 'follows_you', friendshipId: null, isBlocked: false })
    const response = await createFriendRequest(buildRequest({ inviteeUserId: 'invitee-user' }))
    expect(response.status).toBe(200)
    expect(createOrReusePendingFriendshipRequestMock).toHaveBeenCalled()
  })

  it('returns the same not_found shape for a blocked pair as for a nonexistent user (B-FRIENDS-SAFETY-01)', async () => {
    // state 'none' would otherwise fall through to the happy path -- isBlocked
    // must be checked as its own gate, independent of state.
    getRelationshipMock.mockResolvedValueOnce({ state: 'none', friendshipId: null, isBlocked: true })
    const blockedResponse = await createFriendRequest(buildRequest({ inviteeUserId: 'invitee-user' }))
    const blockedBody = await blockedResponse.json()

    getUserByIdMock.mockResolvedValueOnce(null)
    const missingResponse = await createFriendRequest(buildRequest({ inviteeUserId: 'nonexistent-user' }))
    const missingBody = await missingResponse.json()

    expect(blockedResponse.status).toBe(404)
    expect(blockedResponse.status).toBe(missingResponse.status)
    expect(blockedBody).toEqual(missingBody)
    expect(createOrReusePendingFriendshipRequestMock).not.toHaveBeenCalled()
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

// B-FRIENDS-SAFETY-01 Phase 3 — in-memory sliding-window throttle, same
// account-window shape as the /api/friends/search route's rate limiter.
describe('POST /api/friend-requests rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetFriendRequestRateLimitForTests()
    delete process.env.FRIEND_REQUEST_THROTTLE_DISABLED
    getSessionMock.mockResolvedValue({ userId: 'viewer-user' })
    getUserByIdMock.mockResolvedValue({ id: 'invitee-user' })
    getRelationshipMock.mockResolvedValue({ state: 'none', friendshipId: null, isBlocked: false })
    createOrReusePendingFriendshipRequestMock.mockResolvedValue({
      friendship: { id: 'friendship-1', state: 'pending' },
      state: 'created',
    })
  })

  // The numeric limits are read from process.env at MODULE LOAD time (same
  // pattern as the search route's SEARCH_PER_ACCOUNT_WINDOW/SEARCH_PER_IP_WINDOW
  // -- env vars are fixed deploy-time config, not meant to change mid-process),
  // so overriding them per-test has no effect after import. These tests use
  // the real defaults (20/day, 60/week) directly instead.

  it('allows up to the daily per-account limit (20), then 429s with Retry-After', async () => {
    for (let i = 0; i < 20; i++) {
      const response = await createFriendRequest(buildRequest({ inviteeUserId: `invitee-${i}` }))
      expect(response.status).toBe(200)
    }
    expect(createOrReusePendingFriendshipRequestMock).toHaveBeenCalledTimes(20)

    const limited = await createFriendRequest(buildRequest({ inviteeUserId: 'invitee-20' }))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await limited.json()).toEqual({ error: 'rate_limited', reason: 'daily_window' })
    // The blocked call never reached the actual request logic.
    expect(createOrReusePendingFriendshipRequestMock).toHaveBeenCalledTimes(20)
  })

  it('the weekly limit (60) catches a drip that stays under the daily cap each day', async () => {
    // Three days of exactly-at-the-daily-cap (20) requests, 25h apart so the
    // daily window resets between batches but all three stay inside the
    // 7-day weekly window. 60 total lands exactly at the weekly cap; the
    // 61st request (day 4, fresh daily window) must still be blocked --
    // by the WEEKLY window, since the daily count alone would allow it.
    vi.useFakeTimers()
    try {
      const start = new Date('2026-09-01T00:00:00.000Z')
      vi.setSystemTime(start)
      for (let day = 0; day < 3; day++) {
        vi.setSystemTime(new Date(start.getTime() + day * 25 * 60 * 60 * 1000))
        for (let i = 0; i < 20; i++) {
          const response = await createFriendRequest(
            buildRequest({ inviteeUserId: `invitee-${day}-${i}` })
          )
          expect(response.status).toBe(200)
        }
      }
      expect(createOrReusePendingFriendshipRequestMock).toHaveBeenCalledTimes(60)

      vi.setSystemTime(new Date(start.getTime() + 3 * 25 * 60 * 60 * 1000))
      const limited = await createFriendRequest(buildRequest({ inviteeUserId: 'invitee-day4' }))
      expect(limited.status).toBe(429)
      expect((await limited.json()).reason).toBe('weekly_window')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not consume budget on invalid input or a self-request', async () => {
    // Invalid body and a self-request both short-circuit before the
    // relationship lookup -- neither should count against the budget, no
    // matter how many times they're retried.
    for (let i = 0; i < 25; i++) {
      expect((await createFriendRequest(buildRequest({}))).status).toBe(400)
      expect((await createFriendRequest(buildRequest({ inviteeUserId: 'viewer-user' }))).status).toBe(400)
    }
    // The one real attempt still goes through afterward.
    const response = await createFriendRequest(buildRequest({ inviteeUserId: 'invitee-user' }))
    expect(response.status).toBe(200)
    expect(createOrReusePendingFriendshipRequestMock).toHaveBeenCalledTimes(1)
  })

  it('honors the throttle-disable escape hatch past the normal daily cap', async () => {
    process.env.FRIEND_REQUEST_THROTTLE_DISABLED = '1'
    for (let i = 0; i < 25; i++) {
      const response = await createFriendRequest(buildRequest({ inviteeUserId: `invitee-${i}` }))
      expect(response.status).toBe(200)
    }
    expect(createOrReusePendingFriendshipRequestMock).toHaveBeenCalledTimes(25)
  })
})
