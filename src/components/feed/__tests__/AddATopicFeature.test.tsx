import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { addTopicPromoToStreamItem, type StreamEmbed } from '@/lib/activity-stream'
import type { NearbyTerritory } from '@/lib/daily/territory-model'

// The "Add a topic" interlude. It used to be a card pinned above the feed on
// every visit; it now rides IN the feed alongside the other discovery promos
// (Josh, 2026-09-14), so these pin the two halves of that move:
//   - the StreamItem builder produces a home-eligible, NON-expanding row that
//     carries the embed (the shape FeedList's promo splice + render branch read);
//   - the feature component actually renders the suggestions, and its CTA points
//     at the manage surface rather than trying to be a create-your-own field.
// The client fetch that supplies `suggestions` is NOT covered here: the suite is
// SSR-only (vitest environment 'node', no jsdom), so effects never run.

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock('@/components/feed/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => false,
}))

import { AddATopicFeature } from '@/components/feed/EditorialPromos'

function territory(domain: string, broadCategory: string | null = 'Literature'): NearbyTerritory {
  return { domain, broadCategory, reason: 'Near your interests' }
}

const SUGGESTIONS = [
  territory('Wallace Stevens'),
  territory('Ulysses'),
  territory('Rams', 'Sports'),
]

function embed(over: Partial<Extract<StreamEmbed, { kind: 'add_topic' }>> = {}) {
  return {
    kind: 'add_topic' as const,
    href: '/daily/setup',
    suggestions: SUGGESTIONS,
    ...over,
  }
}

describe('addTopicPromoToStreamItem', () => {
  const sortAt = new Date('2026-09-14T12:00:00.000Z')

  it('builds a home-eligible, non-expanding row carrying the embed', () => {
    const item = addTopicPromoToStreamItem(embed(), sortAt, 'add-topic-1')

    expect(item.id).toBe('add-topic-1')
    expect(item.sortAt).toBe(sortAt)
    expect(item.homeEligible).toBe(true)
    // Promos belong to no friend, so they can't be swept into a per-person
    // activity cluster.
    expect(item.friendId).toBeNull()
    // Question-free: an expandable row would offer an answer affordance there
    // is no question for.
    expect(item.expand).toBeNull()
    expect(item.action).toBeNull()
    expect(item.embed).toEqual(embed())
  })

  it('keeps the embed payload intact so the render branch can read it', () => {
    const item = addTopicPromoToStreamItem(embed({ headlineIndex: 7 }), sortAt, 'add-topic-2')

    expect(item.embed?.kind).toBe('add_topic')
    const carried = item.embed as Extract<StreamEmbed, { kind: 'add_topic' }>
    expect(carried.suggestions.map((s) => s.domain)).toEqual([
      'Wallace Stevens',
      'Ulysses',
      'Rams',
    ])
    expect(carried.headlineIndex).toBe(7)
    expect(carried.href).toBe('/daily/setup')
  })
})

describe('AddATopicFeature', () => {
  it('renders the suggested topics and a CTA through to the manage surface', () => {
    const html = renderToStaticMarkup(<AddATopicFeature embed={embed()} />)

    expect(html).toContain('Wallace Stevens')
    expect(html).toContain('Ulysses')
    expect(html).toContain('Rams')
    // "Add your own" is a LINK to the full manage surface, not an inline field —
    // the create-your-own text input is deliberately kept off the feed.
    expect(html).toContain('Add your own')
    expect(html).toContain('href="/daily/setup"')
  })

  it('rotates only the headline by headlineIndex, leaving the CTA fixed', () => {
    const first = renderToStaticMarkup(<AddATopicFeature embed={embed({ headlineIndex: 0 })} />)
    const second = renderToStaticMarkup(<AddATopicFeature embed={embed({ headlineIndex: 1 })} />)

    expect(first).toContain('Something else you')
    expect(second).toContain('What else should we ask you about?')
    expect(first).not.toContain('What else should we ask you about?')
    // Wayfinding copy stays put across the rotation.
    expect(first).toContain('Add your own')
    expect(second).toContain('Add your own')
  })

  it('wraps the index so a day seed far past the pool length still renders', () => {
    // headlineIndex is a raw day seed (~20k+), not a pre-modded index.
    const html = renderToStaticMarkup(<AddATopicFeature embed={embed({ headlineIndex: 20_345 })} />)

    expect(html).toContain('Add your own')
    expect(html).toContain('Wallace Stevens')
  })

  it('shows no confirmation line before anything has been added', () => {
    const html = renderToStaticMarkup(<AddATopicFeature embed={embed()} />)

    expect(html).not.toContain('Undo')
    expect(html).not.toContain('already in your topics')
    expect(html).not.toContain('upcoming round')
  })
})
