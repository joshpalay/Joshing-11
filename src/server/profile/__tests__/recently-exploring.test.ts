import { describe, expect, it } from 'vitest'

import type { DomainMastery } from '@/server/db/queries/knowledge'
import { selectRecentlyExploring } from '@/server/profile/recently-exploring'

const NOW = new Date('2026-06-01T00:00:00.000Z').getTime()

const daysAgo = (days: number) =>
  new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString()

function makeDomain(overrides: Partial<DomainMastery> = {}): DomainMastery {
  return {
    domain: 'french-cinema',
    displayName: 'French Cinema',
    points: 10,
    tier: 'familiar',
    tierProgress: 0.5,
    questionsAnswered: 4,
    questionsCorrect: 3,
    correctRate: 0.75,
    lastActivityAt: daysAgo(2),
    broadCategory: 'Film',
    iconKey: 'film',
    isDeclared: false,
    isDeclaredInterest: false,
    isDemonstrated: true,
    territoryType: 'demonstrated',
    isHidden: false,
    ...overrides,
  }
}

describe('selectRecentlyExploring', () => {
  it('sorts domains most-recent-first', () => {
    const result = selectRecentlyExploring(
      [
        makeDomain({ domain: 'a', displayName: 'A', lastActivityAt: daysAgo(5) }),
        makeDomain({ domain: 'b', displayName: 'B', lastActivityAt: daysAgo(1) }),
        makeDomain({ domain: 'c', displayName: 'C', lastActivityAt: daysAgo(3) }),
      ],
      { now: NOW },
    )

    expect(result.map((d) => d.domain)).toEqual(['b', 'c', 'a'])
  })

  it('excludes hidden domains', () => {
    const result = selectRecentlyExploring(
      [
        makeDomain({ domain: 'visible', displayName: 'Visible' }),
        makeDomain({ domain: 'hidden', displayName: 'Hidden', isHidden: true }),
      ],
      { now: NOW },
    )

    expect(result.map((d) => d.domain)).toEqual(['visible'])
  })

  it('excludes domains with no activity or activity outside the window', () => {
    const result = selectRecentlyExploring(
      [
        makeDomain({ domain: 'recent', displayName: 'Recent', lastActivityAt: daysAgo(2) }),
        makeDomain({ domain: 'stale', displayName: 'Stale', lastActivityAt: daysAgo(45) }),
        makeDomain({ domain: 'none', displayName: 'None', lastActivityAt: null }),
      ],
      { now: NOW },
    )

    expect(result.map((d) => d.domain)).toEqual(['recent'])
  })

  it('respects a custom window', () => {
    const result = selectRecentlyExploring(
      [
        makeDomain({ domain: 'd5', displayName: 'D5', lastActivityAt: daysAgo(5) }),
        makeDomain({ domain: 'd2', displayName: 'D2', lastActivityAt: daysAgo(2) }),
      ],
      { now: NOW, windowDays: 3 },
    )

    expect(result.map((d) => d.domain)).toEqual(['d2'])
  })

  it('caps the list at the limit', () => {
    const domains = Array.from({ length: 8 }, (_, i) =>
      makeDomain({
        domain: `d${i}`,
        displayName: `D${i}`,
        lastActivityAt: daysAgo(i + 1),
      }),
    )

    const result = selectRecentlyExploring(domains, { now: NOW })
    expect(result).toHaveLength(5)
    expect(result.map((d) => d.domain)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4'])
  })

  it('ignores unparseable timestamps', () => {
    const result = selectRecentlyExploring(
      [
        makeDomain({ domain: 'bad', displayName: 'Bad', lastActivityAt: 'not-a-date' }),
        makeDomain({ domain: 'good', displayName: 'Good', lastActivityAt: daysAgo(1) }),
      ],
      { now: NOW },
    )

    expect(result.map((d) => d.domain)).toEqual(['good'])
  })

  it('returns the display shape', () => {
    const result = selectRecentlyExploring(
      [makeDomain({ domain: 'french-cinema', displayName: 'French Cinema', lastActivityAt: daysAgo(1) })],
      { now: NOW },
    )

    expect(result[0]).toEqual({
      domain: 'french-cinema',
      displayName: 'French Cinema',
      lastActivityAt: daysAgo(1),
    })
  })
})
