import { beforeEach, describe, expect, it, vi } from 'vitest'

// B-FRIENDS-SAFETY-01 Phase 1 Done-When: "blocker searches blocked person's
// exact handle -> identical response shape to searching a nonexistent
// handle" and the reverse direction. searchFriendByHandleOrPhone must return
// null in both cases -- indistinguishable from "no such user."

const { dbMock, state, getRelationshipMock } = vi.hoisted(() => {
  const state = {
    userRow: undefined as Record<string, unknown> | undefined,
    isBlocked: false,
    viewerIsBlocker: false,
  }

  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (state.userRow ? [state.userRow] : [])),
        })),
      })),
    })),
  }

  const getRelationshipMock = vi.fn(async () => ({
    state: 'none',
    friendshipId: null,
    formedAt: null,
    isBlocked: state.isBlocked,
  }))

  return { dbMock, state, getRelationshipMock }
})

vi.mock('@/server/db', () => ({
  db: dbMock,
  users: { id: 'users.id', handle: 'users.handle', phoneNumber: 'users.phoneNumber', displayName: 'users.displayName', avatarColor: 'users.avatarColor', createdAt: 'users.createdAt' },
}))

vi.mock('@/server/db/queries/user-blocks', () => ({
  hasBlocked: async () => state.viewerIsBlocker,
}))
vi.mock('@/server/db/queries/friend-requests', () => ({
  getRelationship: getRelationshipMock,
}))

import { searchFriendByHandleOrPhone, searchFriendOutcome } from '@/server/db/queries/friend-search'

const VIEWER = 'viewer-1'
const CANDIDATE = 'candidate-1'

beforeEach(() => {
  state.userRow = undefined
  state.isBlocked = false
  state.viewerIsBlocker = false
  getRelationshipMock.mockClear()
})

describe('searchFriendByHandleOrPhone', () => {
  it('returns null for a handle that matches no user (baseline: not found)', async () => {
    state.userRow = undefined
    const result = await searchFriendByHandleOrPhone(VIEWER, '@nobody')
    expect(result).toBeNull()
  })

  it('returns null when the viewer (blocker) searches a handle they blocked', async () => {
    state.userRow = { id: CANDIDATE, handle: 'bob', displayName: 'Bob', avatarColor: null, createdAt: new Date() }
    state.isBlocked = true
    const result = await searchFriendByHandleOrPhone(VIEWER, '@bob')
    expect(result).toBeNull()
  })

  it('returns null when the blocked person searches the blocker (same relationship, reverse direction)', async () => {
    // isBlockedBetween is direction-agnostic, so getRelationship(candidate, blocker)
    // reports isBlocked: true exactly as getRelationship(blocker, candidate) does.
    state.userRow = { id: VIEWER, handle: 'alice', displayName: 'Alice', avatarColor: null, createdAt: new Date() }
    state.isBlocked = true
    const result = await searchFriendByHandleOrPhone(CANDIDATE, '@alice')
    expect(result).toBeNull()
  })

  it('returns a match when there is no block', async () => {
    state.userRow = { id: CANDIDATE, handle: 'bob', displayName: 'Bob', avatarColor: null, createdAt: new Date() }
    state.isBlocked = false
    const result = await searchFriendByHandleOrPhone(VIEWER, '@bob')
    expect(result).not.toBeNull()
    expect(result?.id).toBe(CANDIDATE)
  })

  // QA 2026-09-26, N5: the blocker may be told they blocked the person (they
  // already know); the blocked side must still get a plain no-match.
  it('tells only the blocker that the searched person is blocked', async () => {
    state.userRow = { id: CANDIDATE, handle: 'bob', displayName: 'Bob', avatarColor: null, createdAt: new Date() }
    state.isBlocked = true
    state.viewerIsBlocker = true
    expect(await searchFriendOutcome(VIEWER, '@bob')).toEqual({ match: null, blockedByViewer: true })

    state.viewerIsBlocker = false
    expect(await searchFriendOutcome(CANDIDATE, '@bob')).toEqual({ match: null, blockedByViewer: false })
  })
})
