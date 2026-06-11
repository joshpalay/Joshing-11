import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// B-HOME-OVERFLOW-02 §7 round-trip test. Home, the "N more →" counts, and the
// overflow subpages all window the SAME pending queue, so this asserts on
// RENDERED HOME OUTPUT across a simulated subpage answer: the answered item
// leaves the shared source, the next pending item is promoted into the freed
// served slot, and the overflow count decrements — silently, with no clearing
// step. It also covers the subpage render mode itself (flat full queue, no
// tabs, no recency buckets, server order preserved).

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/components/feed/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => false,
}))

vi.mock('@/components/feed', () => ({
  DirectSentCard: ({ item }: { item: { avatarName?: string | null } }) => (
    <div data-card="direct">direct:{item.avatarName}</div>
  ),
  FriendAddedCard: ({ item }: { item: { avatarName?: string | null } }) => (
    <div data-card="added">added:{item.avatarName}</div>
  ),
  FriendLikedCard: () => <div data-card="liked" />,
  AnsweredByYouCard: () => <div data-card="answered" />,
  AnswerSheet: () => null,
  AnswerFeedbackSheet: () => null,
  DismissedFeedBar: () => null,
  FeedOverflowMenu: () => null,
  FeedCardSwipe: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  visibleFeedCategory: (c: string | null | undefined) => c ?? null,
}))

vi.mock('@/components/activity/ActivityStreamItem', () => ({
  ActivityStreamItem: ({ item }: { item: { id: string; friendId?: string | null } }) => (
    <div data-activity={item.id}>activity:{item.id}:{item.friendId ?? 'none'}</div>
  ),
}))

vi.mock('@/components/activity/PersonActivityCard', () => ({
  PersonActivityCard: () => <div data-person />,
}))

vi.mock('@/components/feed/EditorialPromos', () => ({
  CommonGroundFeature: () => <div>PANEL:common_ground</div>,
  GrowYourCircleFeature: () => <div>PANEL:add_friends</div>,
  RecentlyExpandingFeature: () => <div>PANEL:recently_expanding</div>,
}))

import FeedList from '@/components/FeedList'
import type { StreamItem } from '@/lib/activity-stream'
import {
  selectHomeEdition,
  type FeedEditionItem,
} from '@/server/home/select-edition'

type AnyItem = Record<string, unknown>

const NOW = Date.parse('2026-06-11T18:00:00Z')

// One distinct sender per item, sent-at ascending with index, so the §5
// sender rotation is deterministic: d0, d1, d2, …
function directItem(i: number): AnyItem {
  return {
    id: `d${i}`,
    kind: 'question',
    card_type: 'direct_sent',
    source_type: 'direct_sent',
    source_user_id: `sender${i}`,
    source_friend_display_name: `sender${i}`,
    source_attribution: `sender${i} sent you a question`,
    source_event_at: `2026-06-11T0${i}:00:00Z`,
    state: 'active',
    is_pinned: false,
    question_id: `d${i}-q`,
    question_text: `Question d${i}`,
    domain_pill: 'Jazz',
    is_in_bank: false,
    viewer_is_author: false,
  }
}

function bundle(i: number, results: Array<'correct' | 'incorrect' | null>): AnyItem {
  return {
    id: `p${i}`,
    friendId: `friend${i}`,
    sortAt: new Date('2026-06-11T12:00:00Z'),
    expand: {
      kind: 'milestone',
      questions: results.map((priorResult, q) => ({ questionId: `p${i}-q${q}`, priorResult })),
    },
  }
}

const META = {
  has_friends: true,
  has_dismissed_domains: false,
  total_item_count: 5,
  active_item_count: 5,
  pre_filter_active_count: 5,
  broadcasts_item_count: 0,
  sent_item_count: 5,
  filter: 'all' as const,
}

// Render Home exactly the way page.tsx does: run the shared selection layer
// over the pending sources, then seed FeedList with the served slices + counts.
function renderHome(feedItems: AnyItem[], activityItems: AnyItem[]): string {
  const edition = selectHomeEdition({
    feedItems: feedItems as unknown as FeedEditionItem[],
    activityItems: activityItems as unknown as StreamItem[],
    promos: { sharedGround: null, expanding: null, growCircle: null },
    now: NOW,
  })
  return renderToStaticMarkup(
    <FeedList
      unifiedHome
      initialPage={{
        viewer_user_id: 'me',
        meta: META,
        items: edition.direct.served,
        has_more: false,
        next_cursor: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any}
      activityItems={[...edition.playables.served, ...edition.texture]}
      budget={{
        directOverflowCount: edition.direct.overflowCount,
        playablesOverflowCount: edition.playables.overflowCount,
        panel: edition.panel,
        isAllEmpty: edition.isAllEmpty,
      }}
    />,
  )
}

describe('overflow subpages — §7 state sync (Home is a window onto the pending queue)', () => {
  it('answering a direct question on the subpage promotes the next item and decrements the count on Home', () => {
    const pending = [0, 1, 2, 3, 4].map(directItem)

    const before = renderHome(pending, [])
    expect(before).toContain('direct:sender0')
    expect(before).toContain('direct:sender2')
    expect(before).not.toContain('direct:sender3') // beyond the served window
    expect(before).toContain('2 more from friends →')
    expect(before).toContain('href="/for-you"')

    // The subpage answer flips d0 to 'answered' server-side, so it simply
    // leaves the pending feed query on Home's next read. No clearing step.
    const afterAnswer = pending.filter((item) => item.id !== 'd0')

    const after = renderHome(afterAnswer, [])
    expect(after).not.toContain('direct:sender0')
    expect(after).toContain('direct:sender3') // promoted into the freed slot
    expect(after).toContain('1 more from friends →')
  })

  it('finishing a playable bundle on the subpage promotes the next bundle and decrements the count on Home', () => {
    const pending = [0, 1, 2, 3, 4, 5].map((i) => bundle(i, [null]))

    const before = renderHome([], pending)
    expect(before).toContain('activity:p0:friend0')
    expect(before).toContain('activity:p3:friend3')
    expect(before).not.toContain('activity:p4:friend4') // beyond the served window
    expect(before).toContain('2 more →')
    expect(before).toContain('href="/from-friends"')

    // The subpage answer records the viewer's result on p0's last open
    // question, so the bundle is no longer pending on Home's next read.
    const afterAnswer = [bundle(0, ['correct']), ...pending.slice(1)]

    const after = renderHome([], afterAnswer)
    expect(after).not.toContain('activity:p0:friend0')
    expect(after).toContain('activity:p4:friend4') // promoted into the freed slot
    expect(after).toContain('1 more →')
  })
})

describe('FeedList — pendingQueue subpage mode (/for-you)', () => {
  it('renders the FULL queue flat, in server order, with no tabs/buckets/headings', () => {
    const html = renderToStaticMarkup(
      <FeedList
        pendingQueue
        initialPage={{
          viewer_user_id: 'me',
          meta: META,
          items: [0, 1, 2, 3, 4].map(directItem),
          has_more: false,
          next_cursor: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any}
      />,
    )

    // Every pending item renders — the subpage is the un-windowed queue.
    for (let i = 0; i < 5; i++) expect(html).toContain(`direct:sender${i}`)
    // No surface tabs, no home section headings, no recency buckets.
    expect(html).not.toContain('Broadcasts')
    expect(html).not.toContain('For You')
    expect(html).not.toContain('Today')
    // No overflow affordance — nothing is windowed here.
    expect(html).not.toContain('more from friends →')
  })

  it('renders the caught-up empty state when the queue is empty', () => {
    const html = renderToStaticMarkup(
      <FeedList
        pendingQueue
        initialPage={{
          viewer_user_id: 'me',
          meta: META,
          items: [],
          has_more: false,
          next_cursor: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any}
      />,
    )
    expect(html).toContain("You&#x27;ve answered every question your friends sent.")
  })
})
