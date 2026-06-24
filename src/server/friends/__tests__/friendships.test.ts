import { beforeEach, describe, expect, it, vi } from 'vitest'

// Friend-add + mutual-accept wiring. These tests lock two things:
//  1. createOrReuse: a fresh auto-approved edge seeds the FOLLOWER's feed with
//     the FOLLOWEE's recent activity (answerer = followee, recipient = follower).
//  2. accept: approving a request makes the two MUTUAL friends — it upserts the
//     accepter's follow-back edge, writes BOTH connection cards (follow_approved
//     to the requester, follow_mutual to the accepter), and seeds BOTH feeds with
//     each other's answers AND authored questions. Getting the direction wrong
//     would seed the wrong person, so it is the highest-value thing to pin.

const { dbMock, state, writeActivityMock, answerBackfillMock, authoredBackfillMock } = vi.hoisted(() => {
  const writeActivityMock = vi.fn(async () => undefined)
  const answerBackfillMock = vi.fn(async () => ({ created: 0 }))
  const authoredBackfillMock = vi.fn(async () => ({ created: 0 }))
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
  }

  return { dbMock, state, writeActivityMock, answerBackfillMock, authoredBackfillMock }
})

vi.mock('@/server/db', () => ({
  db: dbMock,
  follows: { id: 'follows.id', followerId: 'follows.followerId', followeeId: 'follows.followeeId', state: 'follows.state' },
  users: { id: 'users.id', followPrivacy: 'users.followPrivacy' },
}))

vi.mock('@/server/activity/write-activity', () => ({ writeActivity: writeActivityMock }))

vi.mock('@/server/feed/backfill-inviter-feed', () => ({
  backfillFollowedUserFeedItems: answerBackfillMock,
  backfillAuthoredQuestionsFeedItems: authoredBackfillMock,
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
  dbMock.insert.mockClear()
  writeActivityMock.mockClear()
  answerBackfillMock.mockClear()
  authoredBackfillMock.mockClear()
})

describe('createOrReusePendingFriendshipRequest', () => {
  it('forms a MUTUAL friendship when the target is public (both edges, both cards, both feeds)', async () => {
    // No existing edge, public target -> auto-approved + follow-back.
    dbMock._selectQueue.push([], [{ followPrivacy: 'public' }])
    state.returnedEdge = { id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'approved' }

    const result = await createOrReusePendingFriendshipRequest({
      inviterUserId: FOLLOWER,
      inviteeUserId: FOLLOWEE,
    })

    expect(result.state).toBe('auto_approved')
    // Forward edge insert + the mutual follow-back edge upsert.
    expect(dbMock.insert).toHaveBeenCalledTimes(2)
    // Both connection cards: the target learns they were added; the requester
    // gets the "now connected" card.
    expect(writeActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: FOLLOWEE, type: 'follow', actorUserId: FOLLOWER }),
    )
    expect(writeActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: FOLLOWER, type: 'follow_mutual', actorUserId: FOLLOWEE }),
    )
    // Both feeds seeded, both content types.
    expect(answerBackfillMock).toHaveBeenCalledWith({ answererUserId: FOLLOWER, recipientUserId: FOLLOWEE })
    expect(answerBackfillMock).toHaveBeenCalledWith({ answererUserId: FOLLOWEE, recipientUserId: FOLLOWER })
    expect(authoredBackfillMock).toHaveBeenCalledWith({ authorUserId: FOLLOWER, recipientUserId: FOLLOWEE })
    expect(authoredBackfillMock).toHaveBeenCalledWith({ authorUserId: FOLLOWEE, recipientUserId: FOLLOWER })
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
    expect(authoredBackfillMock).not.toHaveBeenCalled()
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
    expect(authoredBackfillMock).not.toHaveBeenCalled()
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

    // Answer backfill BOTH directions.
    expect(answerBackfillMock).toHaveBeenCalledWith({ answererUserId: FOLLOWEE, recipientUserId: FOLLOWER })
    expect(answerBackfillMock).toHaveBeenCalledWith({ answererUserId: FOLLOWER, recipientUserId: FOLLOWEE })

    // Authored-question backfill BOTH directions.
    expect(authoredBackfillMock).toHaveBeenCalledWith({ authorUserId: FOLLOWEE, recipientUserId: FOLLOWER })
    expect(authoredBackfillMock).toHaveBeenCalledWith({ authorUserId: FOLLOWER, recipientUserId: FOLLOWEE })
  })

  it('does nothing when there is no matching pending edge to approve', async () => {
    state.updateReturnsEdge = false

    const edge = await acceptPendingFriendshipRequest({ friendshipId: 'missing', userId: FOLLOWEE })

    expect(edge).toBeNull()
    expect(dbMock.insert).not.toHaveBeenCalled()
    expect(writeActivityMock).not.toHaveBeenCalled()
    expect(answerBackfillMock).not.toHaveBeenCalled()
    expect(authoredBackfillMock).not.toHaveBeenCalled()
  })
})
