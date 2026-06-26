import { beforeEach, describe, expect, it, vi } from 'vitest'

// Friend-add + mutual-accept wiring. These tests lock two things:
//  1. createOrReuse: a fresh auto-approved edge seeds the FOLLOWER's feed with
//     the FOLLOWEE's recent activity (answerer = followee, recipient = follower).
//  2. accept: approving a request makes the two MUTUAL friends — it upserts the
//     accepter's follow-back edge, writes BOTH connection cards (follow_approved
//     to the requester, follow_mutual to the accepter), and seeds BOTH feeds with
//     each other's recent correct ANSWERS (only — authored questions are NOT
//     backfilled). Getting the direction wrong would seed the wrong person, so it
//     is the highest-value thing to pin.

const { dbMock, state, writeActivityMock, softDeleteActivityMock, answerBackfillMock } = vi.hoisted(() => {
  const writeActivityMock = vi.fn(async () => undefined)
  const softDeleteActivityMock = vi.fn(async () => undefined)
  const answerBackfillMock = vi.fn(async () => ({ created: 0 }))
  const state = {
    // The row returned by createOrReusePendingFriendshipRequest's pre-check
    // select (an existing edge) and the inserted/updated edge.
    existingEdge: undefined as Record<string, unknown> | undefined,
    targetPrivacy: 'public' as 'public' | 'private',
    returnedEdge: undefined as Record<string, unknown> | undefined,
    updateReturnsEdge: true,
    deleteReturnsEdge: true,
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
    // values() must support BOTH .returning() (createOrReuse edge insert) and
    // .onConflictDoUpdate() (accept reverse-edge upsert).
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [state.returnedEdge]),
        onConflictDoUpdate: vi.fn(async () => undefined),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => (state.updateReturnsEdge ? [state.returnedEdge] : [])),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => (state.deleteReturnsEdge ? [state.returnedEdge] : [])),
      })),
    })),
  }

  return { dbMock, state, writeActivityMock, softDeleteActivityMock, answerBackfillMock }
})

vi.mock('@/server/db', () => ({
  db: dbMock,
  follows: { id: 'follows.id', followerId: 'follows.followerId', followeeId: 'follows.followeeId', state: 'follows.state' },
  users: { id: 'users.id', followPrivacy: 'users.followPrivacy' },
}))

vi.mock('@/server/activity/write-activity', () => ({
  writeActivity: writeActivityMock,
  softDeleteActivityByReference: softDeleteActivityMock,
}))

vi.mock('@/server/feed/backfill-inviter-feed', () => ({
  backfillFollowedUserFeedItems: answerBackfillMock,
}))

import {
  acceptPendingFriendshipRequest,
  cancelPendingFriendshipRequest,
  createOrReusePendingFriendshipRequest,
  ignorePendingFriendshipRequest,
} from '@/server/friends/friendships'

const FOLLOWER = 'follower-1' // the requester / viewer who adds a friend
const FOLLOWEE = 'followee-1' // the friend being added, whose activity backfills

beforeEach(() => {
  state.existingEdge = undefined
  state.targetPrivacy = 'public'
  state.returnedEdge = undefined
  state.updateReturnsEdge = true
  state.deleteReturnsEdge = true
  dbMock._selectQueue.length = 0
  dbMock.insert.mockClear()
  dbMock.delete.mockClear()
  writeActivityMock.mockClear()
  softDeleteActivityMock.mockClear()
  answerBackfillMock.mockClear()
})

describe('createOrReusePendingFriendshipRequest', () => {
  it('requires an explicit accept even when the target is public (Phase 1: no auto-approve)', async () => {
    // Phase 1 (friend = bidirectional, no asymmetric following): the public
    // auto-approve path is gated off, so a public target lands PENDING like any
    // other request — no mutual edge, no connection cards, no backfill until the
    // target accepts.
    dbMock._selectQueue.push([], [{ followPrivacy: 'public' }])
    state.returnedEdge = { id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'pending' }

    const result = await createOrReusePendingFriendshipRequest({
      inviterUserId: FOLLOWER,
      inviteeUserId: FOLLOWEE,
    })

    expect(result.state).toBe('created')
    // Only the pending forward edge — no mutual follow-back upsert.
    expect(dbMock.insert).toHaveBeenCalledTimes(1)
    // The target gets a request to approve; nobody gets a "now connected" card.
    expect(writeActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: FOLLOWEE, type: 'follow_request', actorUserId: FOLLOWER }),
    )
    expect(writeActivityMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'follow_mutual' }),
    )
    // No feeds seeded until acceptance.
    expect(answerBackfillMock).not.toHaveBeenCalled()
  })

  it('lands pending with NO mutual edge or backfill when the target requires approval', async () => {
    dbMock._selectQueue.push([], [{ followPrivacy: 'private' }])
    state.returnedEdge = { id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'pending' }

    const result = await createOrReusePendingFriendshipRequest({
      inviterUserId: FOLLOWER,
      inviteeUserId: FOLLOWEE,
    })

    expect(result.state).toBe('created')
    expect(dbMock.insert).toHaveBeenCalledTimes(1) // only the pending forward edge
    expect(writeActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: FOLLOWEE, type: 'follow_request', actorUserId: FOLLOWER }),
    )
    expect(answerBackfillMock).not.toHaveBeenCalled()
  })

  it('does NOT re-form or backfill when an approved edge already exists (already_following)', async () => {
    dbMock._selectQueue.push([{ id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'approved' }])

    const result = await createOrReusePendingFriendshipRequest({
      inviterUserId: FOLLOWER,
      inviteeUserId: FOLLOWEE,
    })

    expect(result.state).toBe('already_following')
    expect(dbMock.insert).not.toHaveBeenCalled()
    expect(answerBackfillMock).not.toHaveBeenCalled()
  })
})

describe('acceptPendingFriendshipRequest', () => {
  it('makes the two mutual friends, writes both connection cards, and seeds both feeds', async () => {
    // The accepted edge is the requester (FOLLOWER) -> accepter (FOLLOWEE).
    state.returnedEdge = { id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'approved' }

    const edge = await acceptPendingFriendshipRequest({ friendshipId: 'edge-1', userId: FOLLOWEE })

    expect(edge).not.toBeNull()

    // Mutual: the accepter's follow-back edge is upserted exactly once.
    expect(dbMock.insert).toHaveBeenCalledTimes(1)

    // Two connection cards: the requester learns it was accepted; the accepter
    // gets the "now connected" card.
    expect(writeActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: FOLLOWER, type: 'follow_approved', actorUserId: FOLLOWEE }),
    )
    expect(writeActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: FOLLOWEE, type: 'follow_mutual', actorUserId: FOLLOWER }),
    )

    // Answer backfill BOTH directions (the only backfill — authored questions
    // are intentionally NOT seeded).
    expect(answerBackfillMock).toHaveBeenCalledWith({ answererUserId: FOLLOWEE, recipientUserId: FOLLOWER })
    expect(answerBackfillMock).toHaveBeenCalledWith({ answererUserId: FOLLOWER, recipientUserId: FOLLOWEE })

    // The now-resolved "wants to be friends" row is cleared at the source.
    expect(softDeleteActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ referenceType: 'follow', referenceId: 'edge-1', types: ['follow_request'] }),
    )
  })

  it('does nothing when there is no matching pending edge to approve', async () => {
    state.updateReturnsEdge = false

    const edge = await acceptPendingFriendshipRequest({ friendshipId: 'missing', userId: FOLLOWEE })

    expect(edge).toBeNull()
    expect(dbMock.insert).not.toHaveBeenCalled()
    expect(writeActivityMock).not.toHaveBeenCalled()
    expect(answerBackfillMock).not.toHaveBeenCalled()
  })
})

describe('ignore / cancel clean up the stale follow_request activity', () => {
  it('soft-deletes the follow_request row when a pending request is declined', async () => {
    state.returnedEdge = { id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'pending' }

    const edge = await ignorePendingFriendshipRequest({ friendshipId: 'edge-1', userId: FOLLOWEE })

    expect(edge).not.toBeNull()
    expect(softDeleteActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ referenceType: 'follow', referenceId: 'edge-1', types: ['follow_request'] }),
    )
  })

  it('soft-deletes the follow_request row when the requester cancels', async () => {
    state.returnedEdge = { id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'pending' }

    const edge = await cancelPendingFriendshipRequest({ friendshipId: 'edge-1', userId: FOLLOWER })

    expect(edge).not.toBeNull()
    expect(softDeleteActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ referenceType: 'follow', referenceId: 'edge-1', types: ['follow_request'] }),
    )
  })

  it('does NOT touch activity when there is no matching edge to delete', async () => {
    state.deleteReturnsEdge = false

    const edge = await ignorePendingFriendshipRequest({ friendshipId: 'missing', userId: FOLLOWEE })

    expect(edge).toBeNull()
    expect(softDeleteActivityMock).not.toHaveBeenCalled()
  })
})
