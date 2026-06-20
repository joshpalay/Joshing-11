import { beforeEach, describe, expect, it, vi } from 'vitest'

// Friend-add backfill wiring: these tests lock the follow DIRECTION — a fresh
// approved edge seeds the FOLLOWER's feed with the FOLLOWEE's recent activity
// (answerer = followee, recipient = follower). Getting this backwards would seed
// the wrong person, so it is the highest-value thing to pin.

const { dbMock, state, writeActivityMock, backfillMock } = vi.hoisted(() => {
  const writeActivityMock = vi.fn(async () => undefined)
  const backfillMock = vi.fn(async () => ({ created: 0 }))
  const state = {
    // The row returned by createOrReusePendingFriendshipRequest's pre-check
    // select (an existing edge) and the inserted/updated edge.
    existingEdge: undefined as Record<string, unknown> | undefined,
    targetPrivacy: 'public' as 'public' | 'private',
    returnedEdge: undefined as Record<string, unknown> | undefined,
    updateReturnsEdge: true,
  }

  // db.select() is used twice in createOrReuse: 1st for the existing edge, 2nd
  // for the target's followPrivacy. Resolve in call order via a queue.
  const selectQueue: unknown[][] = []
  function makeSelect() {
    const rows = selectQueue.shift() ?? []
    const limited = { limit: vi.fn(async () => rows) }
    return { from: vi.fn(() => ({ where: vi.fn(() => limited) })) }
  }

  const dbMock = {
    _selectQueue: selectQueue,
    select: vi.fn(() => makeSelect()),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn(async () => [state.returnedEdge]) })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => (state.updateReturnsEdge ? [state.returnedEdge] : [])),
        })),
      })),
    })),
  }

  return { dbMock, state, writeActivityMock, backfillMock }
})

vi.mock('@/server/db', () => ({
  db: dbMock,
  follows: { id: 'follows.id', followerId: 'follows.followerId', followeeId: 'follows.followeeId', state: 'follows.state' },
  users: { id: 'users.id', followPrivacy: 'users.followPrivacy' },
}))

vi.mock('@/server/activity/write-activity', () => ({ writeActivity: writeActivityMock }))

vi.mock('@/server/feed/backfill-inviter-feed', () => ({
  backfillFollowedUserFeedItems: backfillMock,
}))

import { acceptPendingFriendshipRequest, createOrReusePendingFriendshipRequest } from '@/server/friends/friendships'

const FOLLOWER = 'follower-1' // the requester / viewer who adds a friend
const FOLLOWEE = 'followee-1' // the friend being added, whose activity backfills

beforeEach(() => {
  state.existingEdge = undefined
  state.targetPrivacy = 'public'
  state.returnedEdge = undefined
  state.updateReturnsEdge = true
  dbMock._selectQueue.length = 0
  writeActivityMock.mockClear()
  backfillMock.mockClear()
})

describe('createOrReusePendingFriendshipRequest backfill', () => {
  it('backfills the followee\'s activity into the follower\'s feed when auto-approved', async () => {
    // No existing edge, public target -> auto-approved edge is created.
    dbMock._selectQueue.push([], [{ followPrivacy: 'public' }])
    state.returnedEdge = { id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'approved' }

    const result = await createOrReusePendingFriendshipRequest({
      inviterUserId: FOLLOWER,
      inviteeUserId: FOLLOWEE,
    })

    expect(result.state).toBe('auto_approved')
    expect(backfillMock).toHaveBeenCalledTimes(1)
    expect(backfillMock).toHaveBeenCalledWith({ answererUserId: FOLLOWEE, recipientUserId: FOLLOWER })
  })

  it('does NOT backfill when the request lands pending (private target)', async () => {
    dbMock._selectQueue.push([], [{ followPrivacy: 'private' }])
    state.returnedEdge = { id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'pending' }

    const result = await createOrReusePendingFriendshipRequest({
      inviterUserId: FOLLOWER,
      inviteeUserId: FOLLOWEE,
    })

    expect(result.state).toBe('created')
    expect(backfillMock).not.toHaveBeenCalled()
  })

  it('does NOT backfill when the edge already exists (already_following)', async () => {
    dbMock._selectQueue.push([{ id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'approved' }])

    const result = await createOrReusePendingFriendshipRequest({
      inviterUserId: FOLLOWER,
      inviteeUserId: FOLLOWEE,
    })

    expect(result.state).toBe('already_following')
    expect(backfillMock).not.toHaveBeenCalled()
  })
})

describe('acceptPendingFriendshipRequest backfill', () => {
  it('backfills the approver\'s (followee\'s) activity into the requester\'s (follower\'s) feed', async () => {
    state.returnedEdge = { id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'approved' }

    const edge = await acceptPendingFriendshipRequest({ friendshipId: 'edge-1', userId: FOLLOWEE })

    expect(edge).not.toBeNull()
    expect(backfillMock).toHaveBeenCalledTimes(1)
    expect(backfillMock).toHaveBeenCalledWith({ answererUserId: FOLLOWEE, recipientUserId: FOLLOWER })
  })

  it('does NOT backfill when there is no matching pending edge to approve', async () => {
    state.updateReturnsEdge = false

    const edge = await acceptPendingFriendshipRequest({ friendshipId: 'missing', userId: FOLLOWEE })

    expect(edge).toBeNull()
    expect(backfillMock).not.toHaveBeenCalled()
  })
})
