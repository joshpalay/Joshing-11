import { beforeEach, describe, expect, it, vi } from 'vitest'

// B-FRIENDS-SAFETY-01 Phase 2 audit fix: getFriendsHub's edge-classification
// loop used to be `if (approved) {...} else {...pending...}` -- an implicit
// else that would have swept a NEW 'declined' state into the "pending
// request" bucket, showing a declined request in the Friends hub forever.
// This locks the fix: only 'approved' and 'pending' are classified; 'declined'
// is fully skipped (same as if the edge, and the other party, didn't exist).
const { dbMock, state } = vi.hoisted(() => {
  const state = { selectQueue: [] as unknown[][] }

  function makeSelect() {
    const rows = state.selectQueue.shift() ?? []
    const chain: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'orderBy', 'groupBy']) {
      chain[method] = vi.fn(() => chain)
    }
    chain.limit = vi.fn(async () => rows)
    chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(rows)
    return chain
  }

  return { dbMock: { select: vi.fn(() => makeSelect()) }, state }
})

vi.mock('@/server/db', () => ({
  db: dbMock,
  declaredInterests: { userId: 'di.userId', domain: 'di.domain', isActive: 'di.isActive' },
  feedItems: {},
  follows: {
    id: 'follows.id',
    followerId: 'follows.followerId',
    followeeId: 'follows.followeeId',
    state: 'follows.state',
    personalNote: 'follows.personalNote',
    requestContext: 'follows.requestContext',
    createdAt: 'follows.createdAt',
  },
  joshingGameResponses: {},
  masteryEvents: {},
  questions: {},
  users: {
    id: 'users.id',
    displayName: 'users.displayName',
    handle: 'users.handle',
    phoneNumber: 'users.phoneNumber',
    followPrivacy: 'users.followPrivacy',
  },
}))

vi.mock('@/server/feed/visibility', () => ({ DIRECT_SENT_FEED_SOURCE_TYPE: 'direct_sent' }))

import { getFriendsHub } from '@/server/db/queries/friends'

const VIEWER = 'viewer-1'

beforeEach(() => {
  vi.clearAllMocks()
  state.selectQueue = []
})

describe('getFriendsHub — declined edges are fully excluded', () => {
  it('a declined edge contributes NEITHER a friend/follower NOR a pending request; a real pending edge still shows', async () => {
    const now = new Date('2026-09-08T00:00:00.000Z')
    const edges = [
      // Declined: must not appear anywhere in the hub output.
      {
        id: 'e-declined',
        followerId: VIEWER,
        followeeId: 'declined-user',
        state: 'declined',
        personalNote: null,
        requestContext: null,
        createdAt: now,
      },
      // A real pending inbound request — should still surface normally.
      {
        id: 'e-pending-in',
        followerId: 'requester-1',
        followeeId: VIEWER,
        state: 'pending',
        personalNote: null,
        requestContext: null,
        createdAt: now,
      },
    ]
    // Queue order: edges, users(allIds), interests, me. personIds is empty
    // (no approved edges), so getLastActiveByUserId/getFriendQuestionCounts
    // never fire (both early-return on an empty id list) — only these four
    // selects run.
    state.selectQueue.push(
      edges,
      [{ id: 'requester-1', displayName: 'Requester One', phoneNumber: '+15550001111' }],
      [],
      [{ followPrivacy: 'approval_required' }],
    )

    const hub = await getFriendsHub(VIEWER)

    expect(hub.following).toEqual([])
    expect(hub.followers).toEqual([])
    expect(hub.outboundRequests).toEqual([])
    expect(hub.incomingRequests).toHaveLength(1)
    expect(hub.incomingRequests[0]).toMatchObject({
      id: 'e-pending-in',
      requesterId: 'requester-1',
      requesterName: 'Requester One',
    })
    // declined-user never appears in any bucket.
    expect(hub.incomingRequests.some((r) => r.requesterId === 'declined-user')).toBe(false)
    expect(hub.following.some((p) => p.id === 'declined-user')).toBe(false)
    expect(hub.followers.some((p) => p.id === 'declined-user')).toBe(false)
  })
})

// F8 (2026-09-10 audit) — the Friends hub display path used to fall back to
// the raw phone number for a person row with no display name. This exercises
// the full getFriendsHub path (not just the pure resolver) for a legacy
// nameless, handle-less approved follow.
describe('getFriendsHub — display name never falls back to a phone number', () => {
  it('a nameless, handle-less followee shows the generic placeholder, not their phone', async () => {
    const now = new Date('2026-09-08T00:00:00.000Z')
    const edges = [
      {
        id: 'e-following',
        followerId: VIEWER,
        followeeId: 'nameless-friend',
        state: 'approved',
        personalNote: null,
        requestContext: null,
        createdAt: now,
      },
    ]
    // Queue order: edges, users(allIds), interests, then the parallel
    // getLastActiveByUserId (responseRows, masteryRows) and
    // getFriendQuestionCounts (authoredRows, answeredRows) selects — in that
    // order, since Promise.all evaluates its array synchronously
    // left-to-right — then me.
    state.selectQueue.push(
      edges,
      [{ id: 'nameless-friend', displayName: null, handle: null }],
      [],
      [],
      [],
      [],
      [],
      [{ followPrivacy: 'approval_required' }],
    )

    const hub = await getFriendsHub(VIEWER)

    expect(hub.following).toHaveLength(1)
    expect(hub.following[0]?.displayName).toBe('Joshing friend')
    expect(JSON.stringify(hub)).not.toMatch(/\+1\d{10}/)
  })
})
