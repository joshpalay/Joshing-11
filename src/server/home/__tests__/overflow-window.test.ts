import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamItem } from '@/lib/activity-stream'

// B-HOME-OVERFLOW-WINDOW-03 — the "view more" portals are bounded to the same
// rolling home window as the edition, EXCEPT /for-you (the directed gift zone,
// unwindowed by decision). These tests isolate build-edition from the DB by
// mocking the upstream assemblers; the windowing behavior is exercised by a
// buildActivityStream mock that honors the windowDays it is handed.

const {
  buildActivityStreamMock,
  getFeedPagePayloadMock,
  getAddFriendsPromoMock,
  getCommonGroundPromoMock,
  getRecentlyExpandingPromoMock,
} = vi.hoisted(() => ({
  buildActivityStreamMock: vi.fn(),
  getFeedPagePayloadMock: vi.fn(),
  getAddFriendsPromoMock: vi.fn(),
  getCommonGroundPromoMock: vi.fn(),
  getRecentlyExpandingPromoMock: vi.fn(),
}))

vi.mock('@/server/activity/build-stream', () => ({ buildActivityStream: buildActivityStreamMock }))
vi.mock('@/server/feed/get-feed-page', () => ({ getFeedPagePayload: getFeedPagePayloadMock }))
vi.mock('@/server/activity/add-friends-promo', () => ({ getAddFriendsPromo: getAddFriendsPromoMock }))
vi.mock('@/server/activity/common-ground-promo', () => ({ getCommonGroundPromo: getCommonGroundPromoMock }))
vi.mock('@/server/activity/recently-expanding-promo', () => ({
  getRecentlyExpandingPromo: getRecentlyExpandingPromoMock,
}))

import {
  buildFriendActivityQueue,
  buildPendingDirectQueue,
} from '@/server/home/build-edition'
import { HOME_WINDOW_DAYS } from '@/server/home/select-edition'

const DAY = 24 * 60 * 60 * 1000

function bundle(id: string, ageDays: number): StreamItem {
  return {
    id,
    friendId: id,
    sortAt: new Date(Date.now() - ageDays * DAY),
    action: null,
    expand: { kind: 'milestone', questions: [{ questionId: `${id}-q` }] },
  } as unknown as StreamItem
}

// The full (un-windowed) friend-activity log the real stream would assemble.
const ALL_BUNDLES = (): StreamItem[] => [bundle('b-6d', 6), bundle('b-8d', 8), bundle('b-40d', 40)]

describe('buildFriendActivityQueue — /from-friends overflow is 7-day windowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Honor the window the caller passes — exactly what the real source queries do.
    buildActivityStreamMock.mockImplementation(async (_userId: string, options?: { windowDays?: number }) => {
      const all = ALL_BUNDLES()
      const windowDays = options?.windowDays
      if (windowDays === undefined) return all
      const floor = Date.now() - windowDays * DAY
      return all.filter((b) => b.sortAt.getTime() >= floor)
    })
  })

  it('passes HOME_WINDOW_DAYS to the underlying stream', async () => {
    await buildFriendActivityQueue('u1')
    expect(buildActivityStreamMock).toHaveBeenCalledWith('u1', { windowDays: HOME_WINDOW_DAYS })
  })

  it('excludes an 8-day-old bundle and includes a 6-day-old one', async () => {
    const ids = (await buildFriendActivityQueue('u1')).map((i) => i.id)
    expect(ids).toContain('b-6d')
    expect(ids).not.toContain('b-8d')
    expect(ids).not.toContain('b-40d')
  })
})

describe('buildPendingDirectQueue — /for-you stays all-time (gift zone, unwindowed)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getFeedPagePayloadMock.mockResolvedValue({
      // A directed question sent years ago — must still be served.
      items: [
        {
          id: 'd-old',
          source_user_id: 'sender',
          source_event_at: '2023-01-01T00:00:00Z',
        },
      ],
      meta: { active_item_count: 1 },
    })
  })

  it('returns an all-time pending directed item and applies no window', async () => {
    const { items } = await buildPendingDirectQueue('u1')
    expect(items.map((i) => i.id)).toContain('d-old')
    // The feed page is fetched with paging/filter only — no window parameter —
    // and the windowed activity stream is never consulted for the gift zone.
    expect(getFeedPagePayloadMock).toHaveBeenCalledWith('u1', { limit: 50, cursor: null, filter: 'all' })
    expect(buildActivityStreamMock).not.toHaveBeenCalled()
  })
})
