import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// D-HOME-PACING-01 render test. The selection layer is unit-tested separately
// (src/server/home/__tests__/select-edition.test.ts); this asserts that the
// budgeted CLIENT path actually RENDERS the served slices, the "N more →"
// overflow affordances, the single panel, and the all-empty switch — so a green
// selection test can't mask an unbuilt render path (the known fragile pattern).

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/components/feed/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => false,
}))

// Stub the feed-card subsystem to lightweight markers so the test exercises the
// budgeted SECTIONING, not the card internals (covered by FeedCards.test.tsx).
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

type AnyItem = Record<string, unknown>

function directItem(id: string, sender: string): AnyItem {
  return {
    id,
    kind: 'question',
    card_type: 'direct_sent',
    source_type: 'direct_sent',
    source_user_id: sender,
    source_friend_display_name: sender,
    source_attribution: `${sender} sent you a question`,
    source_event_at: '2026-06-11T09:00:00Z',
    state: 'active',
    is_pinned: false,
    question_id: `${id}-q`,
    question_text: `Question ${id}`,
    domain_pill: 'Jazz',
    is_in_bank: false,
    viewer_is_author: false,
  }
}

function playable(id: string, friendId: string): AnyItem {
  return {
    id,
    friendId,
    sortAt: new Date('2026-06-11T12:00:00Z'),
    tier: 1,
    homeEligible: true,
    line: [],
    secondLine: null,
    anchorId: null,
    action: null,
    icon: null,
    expand: { kind: 'milestone', questions: [{ questionId: `${id}-q`, text: 'q', domain: 'Jazz' }] },
  }
}

function texture(id: string): AnyItem {
  return {
    id,
    friendId: 'tex-friend',
    relationship: 'got_you',
    sortAt: new Date('2026-06-11T11:00:00Z'),
    tier: 3,
    homeEligible: true,
    line: [],
    secondLine: null,
    anchorId: null,
    action: null,
    icon: null,
    expand: null,
  }
}

const META = {
  has_friends: true,
  has_dismissed_domains: false,
  total_item_count: 0,
  active_item_count: 0,
  pre_filter_active_count: 0,
  broadcasts_item_count: 0,
  sent_item_count: 0,
  filter: 'all' as const,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(props: any): string {
  return renderToStaticMarkup(<FeedList {...props} />)
}

describe('FeedList — budgeted home edition (D-HOME-PACING-01)', () => {
  it('renders served slices with a quiet "N more →" affordance per question zone', () => {
    const html = render({
      unifiedHome: true,
      initialPage: {
        viewer_user_id: 'me',
        meta: META,
        items: [directItem('d0', 'robyn'), directItem('d1', 'joshua'), directItem('d2', 'mara')],
        has_more: false,
        next_cursor: null,
      },
      activityItems: [playable('p0', 'josh'), playable('p1', 'rob'), texture('t0')],
      budget: {
        directOverflowCount: 4,
        playablesOverflowCount: 3,
        panel: { id: 'gc', friendId: null, sortAt: new Date('2026-06-11T12:00:00Z'), expand: null, embed: { kind: 'add_friends' } },
        isAllEmpty: false,
      },
    })

    // Both question zones render their headings and overflow affordances,
    // each linking to its zone's overflow subpage (B-HOME-OVERFLOW-02).
    expect(html).toContain('For You')
    expect(html).toContain('From Friends')
    expect(html).toContain('4 more from friends →')
    expect(html).toContain('3 more →')
    expect(html).toContain('href="/for-you"')
    expect(html).toContain('href="/from-friends"')
    // Served direct cards and playables both rendered.
    expect(html).toContain('direct:robyn')
    expect(html).toContain('activity:p0:josh')
    // Texture row rendered, and NO temporal recency bucket heading (§4 removed).
    expect(html).toContain('activity:t0:tex-friend')
    expect(html).not.toContain('Today')
    expect(html).not.toContain('Past two weeks')
    // Exactly one rotating panel.
    expect(html).toContain('PANEL:add_friends')
  })

  it('all three zones empty → inline empty state, panel suppressed (§9)', () => {
    const html = render({
      unifiedHome: true,
      initialPage: { viewer_user_id: 'me', meta: META, items: [], has_more: false, next_cursor: null },
      activityItems: [],
      budget: { directOverflowCount: 0, playablesOverflowCount: 0, panel: null, isAllEmpty: true },
    })

    // The existing empty-state copy is revived; the speech-bubble art renders.
    expect(html).toContain('Quiet today')
    // No panel double-invite, no zone headings.
    expect(html).not.toContain('PANEL')
    expect(html).not.toContain('For You')
    expect(html).not.toContain('From Friends')
  })

  it('partial-empty → empty zones omitted, populated zones shown (§9)', () => {
    const html = render({
      unifiedHome: true,
      initialPage: {
        viewer_user_id: 'me',
        meta: META,
        items: [directItem('d0', 'robyn')],
        has_more: false,
        next_cursor: null,
      },
      activityItems: [], // no playables, no texture
      budget: {
        directOverflowCount: 0,
        playablesOverflowCount: 0,
        panel: { id: 'sg', friendId: null, sortAt: new Date('2026-06-11T12:00:00Z'), expand: null, embed: { kind: 'common_ground' } },
        isAllEmpty: false,
      },
    })

    expect(html).toContain('For You')
    expect(html).toContain('direct:robyn')
    // The empty playable zone is omitted entirely — no heading, no placeholder.
    expect(html).not.toContain('From Friends')
    expect(html).not.toContain('Quiet today')
    // The populated page still gets its one panel.
    expect(html).toContain('PANEL:common_ground')
  })
})
