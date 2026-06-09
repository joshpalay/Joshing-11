import { beforeEach, describe, expect, it, vi } from 'vitest';

// The home-only "Your world is expanding" promo: a first-class module mirroring
// the /knowledge Recently Expanding module (capped at 3 rows) with a link to
// /knowledge. We mock the one query it reads so we can assert the cap and the
// empty-state short-circuit without a DB.
const { getExpandingDomainsMock } = vi.hoisted(() => ({
  getExpandingDomainsMock: vi.fn(),
}));

vi.mock('@/server/db/queries/knowledge', () => ({
  getExpandingDomains: getExpandingDomainsMock,
}));

import { getRecentlyExpandingPromo } from '@/server/activity/recently-expanding-promo';

type Reason = 'new-discovery' | 'mastery-shift' | 'social-overlap' | 'saved-questions' | 'active-play';

function domain(name: string, reason: Reason = 'new-discovery', supportingText?: string) {
  return { domain: name, momentumScore: 50, reason, supportingText };
}

const NOW = new Date('2026-06-08T12:00:00Z');

describe('getRecentlyExpandingPromo', () => {
  beforeEach(() => {
    getExpandingDomainsMock.mockReset();
  });

  it('returns null when the viewer has no expanding territories', async () => {
    getExpandingDomainsMock.mockResolvedValue([]);
    const result = await getRecentlyExpandingPromo('user-1', NOW);
    expect(result).toBeNull();
  });

  it('builds a recently_expanding embed capped at three rows', async () => {
    getExpandingDomainsMock.mockResolvedValue([
      domain('Star Trek', 'social-overlap', 'Shared overlap grew here.'),
      domain('Classic Broadway Musicals', 'new-discovery', 'New territory opened this week.'),
      domain('Wagner Ring Cycle', 'mastery-shift', 'This territory moved recently.'),
      domain('John Milton Paradise Lost', 'active-play'),
    ]);

    const item = await getRecentlyExpandingPromo('user-1', NOW);
    expect(item).not.toBeNull();
    expect(item!.embed?.kind).toBe('recently_expanding');
    const embed = item!.embed as Extract<NonNullable<typeof item.embed>, { kind: 'recently_expanding' }>;
    expect(embed.href).toBe('/knowledge');
    expect(embed.domains).toHaveLength(3);
    expect(embed.domains.map((d) => d.label)).toEqual([
      'Star Trek',
      'Classic Broadway Musicals',
      'Wagner Ring Cycle',
    ]);
    // Badge initials are the first meaningful letter of the domain name.
    expect(embed.domains.map((d) => d.initial)).toEqual(['S', 'C', 'W']);
  });

  it('swaps the "territory moved recently" placeholder for a qualitative label', async () => {
    getExpandingDomainsMock.mockResolvedValue([
      domain('Wagner Ring Cycle', 'mastery-shift', 'This territory moved recently.'),
    ]);
    const item = await getRecentlyExpandingPromo('user-1', NOW);
    const embed = item!.embed as Extract<NonNullable<typeof item.embed>, { kind: 'recently_expanding' }>;
    expect(embed.domains[0]!.caption).toBe('Leveling up');
  });
});
