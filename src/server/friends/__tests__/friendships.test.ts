import { beforeEach, describe, expect, it, vi } from 'vitest'

// Friend-add + mutual-accept wiring. These tests lock:
//  1. createOrReuse: a fresh auto-approved edge seeds the FOLLOWER's feed with
//     the FOLLOWEE's recent activity (answerer = followee, recipient = follower).
//  2. accept: approving a request makes the two MUTUAL friends — it upserts the
//     accepter's follow-back edge, writes BOTH connection cards (follow_approved
//     to the requester, follow_mutual to the accepter), and seeds BOTH feeds with
//     each other's recent correct ANSWERS (only — authored questions are NOT
//     backfilled). Getting the direction wrong would seed the wrong person, so it
//     is the highest-value thing to pin.
//  3. B-FRIENDS-SAFETY-01 Phase 2: decline transitions the edge to 'declined'
//     (an UPDATE, not a delete) and createOrReuse enforces a re-request
//     cooldown off declinedAt — no new/revived edge inside the cooldown
//     window, a real upsert once it elapses.

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
    // values() must support BOTH .returning() (a fresh createOrReuse insert)
    // and .onConflictDoUpdate() -- which itself must support both a bare
    // await (ensureApprovedFollowEdge's reverse-edge upsert, fire-and-forget)
    // AND a chained .returning() (createOrReuse's post-cooldown revival of a
    // declined row). Thenable + chainable covers both call shapes.
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [state.returnedEdge]),
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn(async () => [state.returnedEdge]),
          then: (resolve: (value: undefined) => unknown) => resolve(undefined),
        })),
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
  dbMock.update.mockClear()
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

describe('createOrReusePendingFriendshipRequest — B-FRIENDS-SAFETY-01 Phase 2 decline cooldown', () => {
  const DECLINED_AT = new Date('2026-08-09T00:00:00.000Z') // 30-day default cooldown boundary is 2026-09-08

  it('decline, re-request INSIDE the cooldown -> declined_cooldown, no new edge, no activity row', async () => {
    dbMock._selectQueue.push([
      { id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'declined', declinedAt: DECLINED_AT },
    ])
    const now = new Date('2026-09-01T00:00:00.000Z') // 23 days after decline — inside the 30-day cooldown

    const result = await createOrReusePendingFriendshipRequest({
      inviterUserId: FOLLOWER,
      inviteeUserId: FOLLOWEE,
      now,
    })

    expect(result.state).toBe('declined_cooldown')
    expect(result.friendship).toMatchObject({ id: 'edge-1', state: 'declined' })
    // No new/revived edge -- only the pre-check select ran.
    expect(dbMock.insert).not.toHaveBeenCalled()
    expect(writeActivityMock).not.toHaveBeenCalled()
    expect(answerBackfillMock).not.toHaveBeenCalled()
  })

  it('decline, re-request AFTER the cooldown -> revives the row into a new pending edge', async () => {
    dbMock._selectQueue.push(
      [{ id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'declined', declinedAt: DECLINED_AT }],
      [{ followPrivacy: 'private' }],
    )
    state.returnedEdge = { id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'pending' }
    const now = new Date('2026-09-09T00:00:01.000Z') // just past the 30-day cooldown

    const result = await createOrReusePendingFriendshipRequest({
      inviterUserId: FOLLOWER,
      inviteeUserId: FOLLOWEE,
      now,
    })

    expect(result.state).toBe('created')
    expect(result.friendship.state).toBe('pending')
    // Revival is an upsert on the SAME (followerId, followeeId) pair, not a
    // second distinct row.
    expect(dbMock.insert).toHaveBeenCalledTimes(1)
    expect(writeActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: FOLLOWEE, type: 'follow_request', actorUserId: FOLLOWER }),
    )
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
  it('transitions the edge to declined with a declinedAt timestamp (B-FRIENDS-SAFETY-01 Phase 2: UPDATE, not a delete)', async () => {
    state.returnedEdge = { id: 'edge-1', followerId: FOLLOWER, followeeId: FOLLOWEE, state: 'declined' }
    const now = new Date('2026-09-08T12:00:00.000Z')

    const edge = await ignorePendingFriendshipRequest({ friendshipId: 'edge-1', userId: FOLLOWEE, now })

    expect(edge).not.toBeNull()
    expect(dbMock.update).toHaveBeenCalledTimes(1)
    expect(dbMock.delete).not.toHaveBeenCalled()
    // The mocked .set() isn't spied directly (it's rebuilt per call), so pin the
    // real call shape via the mock factory's arguments instead of a jest-style
    // toHaveBeenCalledWith on set() -- assert through the update() call itself.
    const setArgFromMock = (dbMock.update.mock.results[0]?.value as { set: ReturnType<typeof vi.fn> }).set
    expect(setArgFromMock).toHaveBeenCalledWith({ state: 'declined', declinedAt: now })
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

  it('does NOT touch activity when there is no matching pending edge to decline', async () => {
    // B-FRIENDS-SAFETY-01 Phase 2: decline is now an UPDATE (pending -> declined),
    // not a delete -- the "no match" case is gated by updateReturnsEdge.
    state.updateReturnsEdge = false

    const edge = await ignorePendingFriendshipRequest({ friendshipId: 'missing', userId: FOLLOWEE })

    expect(edge).toBeNull()
    expect(softDeleteActivityMock).not.toHaveBeenCalled()
  })

  it('does NOT touch activity when there is no matching edge to cancel', async () => {
    state.deleteReturnsEdge = false

    const edge = await cancelPendingFriendshipRequest({ friendshipId: 'missing', userId: FOLLOWER })

    expect(edge).toBeNull()
    expect(softDeleteActivityMock).not.toHaveBeenCalled()
  })
})
