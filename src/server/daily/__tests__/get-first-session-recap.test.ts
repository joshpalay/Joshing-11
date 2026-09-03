import { beforeEach, describe, expect, it, vi } from 'vitest'

// getFirstSessionRecap touches two tables through db.select: `users` (seen
// signal + display name) and `feedItems` (inviter-backfill presence check).
// The mock dispatches on table identity, same pattern as the other db-mock
// tests in this codebase (e.g. invite-onboarding.test.ts).
const { state, dbMock, getInviterForUserMock, getDailySummaryMock, users, feedItems } =
  vi.hoisted(() => {
    const state = {
      userRows: [] as Array<{ displayName: string | null; seenAt: Date | null }>,
      feedItemRows: [] as Array<{ id: string }>,
      inviter: null as {
        inviterUserId: string
        inviterName: string | null
        sourceId: string
        sourceType: 'friend_invitation' | 'follow'
      } | null,
    }

    const users = { __table: 'users' }
    const feedItems = { __table: 'feedItems' }

    const dbMock = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          if (table === users) {
            return { where: vi.fn(() => ({ limit: vi.fn(async () => state.userRows) })) }
          }
          return { where: vi.fn(() => ({ limit: vi.fn(async () => state.feedItemRows) })) }
        }),
      })),
      update: vi.fn(),
    }

    return {
      state,
      dbMock,
      getInviterForUserMock: vi.fn(async () => state.inviter),
      getDailySummaryMock: vi.fn(),
      users,
      feedItems,
    }
  })

vi.mock('@/server/db', () => ({ db: dbMock, users, feedItems }))
vi.mock('@/server/db/queries/daily-summary', () => ({ getDailySummary: getDailySummaryMock }))
vi.mock('@/server/db/queries/friend-invitations', () => ({
  getInviterForUser: getInviterForUserMock,
}))
vi.mock('@/server/feed/visibility', () => ({ SOCIAL_FEED_SOURCE_TYPE: 'social' }))

import { getFirstSessionRecap } from '@/server/daily/get-first-session-recap'

function baseSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isFirstCompletedRound: true,
    questions: [{ domainDisplayName: 'History', isCorrect: true, isSkipped: false }],
    ...overrides,
  }
}

describe('getFirstSessionRecap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.userRows = [{ displayName: 'Ada', seenAt: null }]
    state.feedItemRows = []
    state.inviter = null
    getDailySummaryMock.mockResolvedValue(baseSummary())
  })

  it('returns null when the recap has already been seen', async () => {
    state.userRows = [{ displayName: 'Ada', seenAt: new Date('2026-06-01T00:00:00.000Z') }]

    await expect(getFirstSessionRecap('user-1')).resolves.toBeNull()
    expect(getInviterForUserMock).not.toHaveBeenCalled()
  })

  it('Beat 3 is no-inviter when getInviterForUser resolves null', async () => {
    state.inviter = null

    const view = await getFirstSessionRecap('user-1')

    expect(view?.beat3).toEqual({ kind: 'no_inviter' })
  })

  // Boundary-level coverage per Stage 1: a link-arrived user's inviter comes
  // back through the follow-fallback branch of getInviterForUser (no
  // FriendInvitation row) — Beat 3 must still name them, not silently drop to
  // the no-inviter copy the way the pre-resolver inline query did.
  it('Beat 3 names the inviter resolved via the follow fallback (link-arrived user)', async () => {
    state.inviter = {
      inviterUserId: 'inviter-2',
      inviterName: 'Jaime',
      sourceId: 'follow-1',
      sourceType: 'follow',
    }
    state.feedItemRows = [] // backfill hasn't landed yet -> future tense

    const view = await getFirstSessionRecap('user-2')

    expect(view?.beat3).toEqual({ kind: 'inviter_future', inviterName: 'Jaime' })
  })

  it('Beat 3 is present-tense when the inviter backfill seeded the home feed', async () => {
    state.inviter = {
      inviterUserId: 'inviter-2',
      inviterName: 'Jaime',
      sourceId: 'follow-1',
      sourceType: 'follow',
    }
    state.feedItemRows = [{ id: 'feed-1' }]

    const view = await getFirstSessionRecap('user-2')

    expect(view?.beat3).toEqual({ kind: 'inviter_present', inviterName: 'Jaime' })
  })

  it('falls back to "Your friend" when the inviter has no display name set', async () => {
    state.inviter = {
      inviterUserId: 'inviter-3',
      inviterName: null,
      sourceId: 'inv-3',
      sourceType: 'friend_invitation',
    }

    const view = await getFirstSessionRecap('user-3')

    expect(view?.beat3).toEqual({ kind: 'inviter_future', inviterName: 'Your friend' })
  })
})
