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
      activityItems: [
        playable('p0', 'josh'),
        playable('p1', 'rob'),
        texture('t0'),
        texture('t1'),
        texture('t2'),
        texture('t3'),
        texture('t4'),
      ],
      budget: {
        directOverflowCount: 4,
        playablesOverflowCount: 3,
        panel: { id: 'gc', friendId: null, sortAt: new Date('2026-06-11T12:00:00Z'), expand: null, embed: { kind: 'add_friends' } },
        isAllEmpty: false,
      },
    })

    // Both question zones render their headings and overflow affordances,
    // each linking to its zone's overflow subpage (B-HOME-OVERFLOW-02).
    expect(html).toContain('questions your friends created or sent directly to you')
    expect(html).toContain('From Friends')
    expect(html).toContain('4 more from friends →')
    expect(html).toContain('3 more →')
    // B-HOME-BAND-LABEL-04 — one "Past 7 days" band label governs the ambient
    // zones, stated once, and Zone 1 (the directed "For you" eyebrow) sits ABOVE
    // it, outside the windowed band. The per-zone labels are demoted beneath it.
    expect(html).toContain('Past 7 days')
    expect(html.match(/Past 7 days/g) ?? []).toHaveLength(1)
    expect(html).toContain('Recent activity')
    expect(html.indexOf('questions your friends created or sent directly to you')).toBeLessThan(
      html.indexOf('Past 7 days'),
    )
    expect(html.indexOf('Past 7 days')).toBeLessThan(html.indexOf('From Friends'))
    expect(html).toContain('href="/for-you"')
    expect(html).toContain('href="/from-friends"')
    // Served direct cards and playables both rendered.
    expect(html).toContain('direct:robyn')
    expect(html).toContain('activity:p0:josh')
    // Texture row rendered, and NO temporal recency bucket heading (§4 removed).
    expect(html).toContain('activity:t0:tex-friend')
    expect(html).not.toContain('Today')
    expect(html).not.toContain('Past two weeks')
    // Texture's see-more goes to Lately (the archive of this stream) — no third
    // subpage (§4); the revived "See all activity →" row closes the zone.
    expect(html).toContain('See all activity →')
    expect(html).toContain('href="/activities"')
    // Exactly one rotating panel, interleaved after the third texture row
    // (§2 slot 5, tuned 2026-06-12): t0 t1 t2, panel, t3 t4, see-all.
    const panelAt = html.indexOf('PANEL:add_friends')
    expect(panelAt).toBeGreaterThan(html.indexOf('activity:t2:'))
    expect(panelAt).toBeLessThan(html.indexOf('activity:t3:'))
    expect(html.indexOf('See all activity →')).toBeGreaterThan(html.indexOf('activity:t4:'))
    expect(html.lastIndexOf('PANEL:')).toBe(panelAt) // one panel, not two
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
    expect(html).not.toContain('questions your friends created or sent directly to you')
    expect(html).not.toContain('From Friends')
    // The whole-page promo WINS when everything is empty: no band label and no
    // per-section honest empties stacked underneath it (B-HOME-BAND-LABEL-04).
    expect(html).not.toContain('Past 7 days')
    expect(html).not.toContain('No friend activity this week')
    expect(html).not.toContain('Nothing else this week')
  })

  it('partial-empty → empty ambient sections are hidden outright (point 4 reverted 2026-06-15)', () => {
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
        emptySections: { fromFriends: true, texture: true, sharedGround: true },
      },
    })

    expect(html).toContain('questions your friends created or sent directly to you')
    expect(html).toContain('direct:robyn')
    // Empty ambient sections are hidden outright — no sub-label, no art, no
    // "honest empty" copy. The band still labels itself because the quiet-week
    // foot panel keeps content beneath the boundary.
    expect(html).toContain('Past 7 days')
    expect(html).not.toContain('From Friends')
    expect(html).not.toContain('No friend activity this week')
    expect(html).not.toContain('Recent activity')
    expect(html).not.toContain('Nothing else this week')
    // NOT the whole-page promo (that is for total emptiness only).
    expect(html).not.toContain('Quiet today')
    expect(html).not.toContain('add friends →')
    // The texture see-more is hidden with its (empty) zone.
    expect(html).not.toContain('See all activity')
    // The populated page still gets its one panel (quiet-week foot fallback).
    expect(html).toContain('PANEL:common_ground')
  })

  it('asymmetric partial-empty → From Friends renders, empty Recent activity is hidden', () => {
    const html = render({
      unifiedHome: true,
      initialPage: { viewer_user_id: 'me', meta: META, items: [], has_more: false, next_cursor: null },
      activityItems: [playable('p0', 'josh'), playable('p1', 'rob')], // playables present, no texture
      budget: {
        directOverflowCount: 0,
        playablesOverflowCount: 0,
        panel: { id: 'gc', friendId: null, sortAt: new Date('2026-06-11T12:00:00Z'), expand: null, embed: { kind: 'add_friends' } },
        isAllEmpty: false,
        emptySections: { fromFriends: false, texture: true, sharedGround: true },
      },
    })

    expect(html).toContain('Past 7 days')
    // From Friends has content → real rows, no honest empty there.
    expect(html).toContain('From Friends')
    expect(html).toContain('activity:p0:josh')
    expect(html).not.toContain('No friend activity this week')
    // Recent activity is empty-in-window → hidden outright, no honest empty.
    expect(html).not.toContain('Recent activity')
    expect(html).not.toContain('Nothing else this week')
    expect(html).not.toContain('Quiet today')
  })
})
