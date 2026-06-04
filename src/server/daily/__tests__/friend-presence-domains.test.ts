import { describe, expect, it } from 'vitest';

import {
  rankFriendDomainsForBonus,
  type FriendDomainContribution,
} from '@/server/db/queries/friend-presence-domains';

let seq = 0;
function contribution(over: Partial<FriendDomainContribution> = {}): FriendDomainContribution {
  seq += 1;
  return {
    friendId: `f-${seq}`,
    friendDisplayName: `Friend ${seq}`,
    domain: 'jazz',
    broadCategory: 'music',
    inTerritory: true,
    inActivity: false,
    lastActivityAt: null,
    strength: 0,
    ...over,
  };
}

const ms = (iso: string) => new Date(iso).getTime();

describe('rankFriendDomainsForBonus — signal ranking', () => {
  it('ranks Both > territory-only > activity-only', () => {
    const both = contribution({ domain: 'both-domain', inTerritory: true, inActivity: true });
    const territory = contribution({ domain: 'territory-domain', inTerritory: true, inActivity: false });
    const activity = contribution({ domain: 'activity-domain', inTerritory: false, inActivity: true });
    const ranked = rankFriendDomainsForBonus([activity, territory, both], 3);
    expect(ranked.map((c) => c.domain)).toEqual(['both-domain', 'territory-domain', 'activity-domain']);
    expect(ranked.map((c) => c.signal)).toEqual(['both', 'territory', 'activity']);
  });

  it('merges signals across friends: territory from one + activity from another → Both', () => {
    const fromA = contribution({ friendId: 'a', domain: 'shared', inTerritory: true, inActivity: false });
    const fromB = contribution({ friendId: 'b', domain: 'shared', inTerritory: false, inActivity: true });
    const ranked = rankFriendDomainsForBonus([fromA, fromB], 2);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].signal).toBe('both');
  });
});

describe('rankFriendDomainsForBonus — tie-breaks', () => {
  it('within a signal, more recent activity ranks first', () => {
    const older = contribution({ domain: 'older', inActivity: true, lastActivityAt: ms('2026-05-01') });
    const newer = contribution({ domain: 'newer', inActivity: true, lastActivityAt: ms('2026-05-20') });
    const ranked = rankFriendDomainsForBonus([older, newer], 2);
    expect(ranked.map((c) => c.domain)).toEqual(['newer', 'older']);
  });

  it('breaks a recency tie by strength, but strength is NOT a gate', () => {
    // Same signal, same (null) recency: the stronger domain ranks first, but the
    // zero-strength territory domain is still eligible (present in the result).
    const weak = contribution({ domain: 'weak', strength: 0, lastActivityAt: null });
    const strong = contribution({ domain: 'strong', strength: 500, lastActivityAt: null });
    const ranked = rankFriendDomainsForBonus([weak, strong], 2);
    expect(ranked.map((c) => c.domain)).toEqual(['strong', 'weak']);
    expect(ranked).toHaveLength(2);
  });

  it('recency beats strength (recency is the higher tie-break)', () => {
    const recentWeak = contribution({ domain: 'recent-weak', inActivity: true, strength: 0, lastActivityAt: ms('2026-05-20') });
    const oldStrong = contribution({ domain: 'old-strong', inActivity: true, strength: 999, lastActivityAt: ms('2026-05-01') });
    const ranked = rankFriendDomainsForBonus([oldStrong, recentWeak], 2);
    expect(ranked.map((c) => c.domain)).toEqual(['recent-weak', 'old-strong']);
  });
});

describe('rankFriendDomainsForBonus — dedup, caps, attribution', () => {
  it('dedups by domain and caps at the limit', () => {
    const a = contribution({ friendId: 'a', domain: 'jazz', lastActivityAt: ms('2026-05-01') });
    const b = contribution({ friendId: 'b', domain: 'jazz', lastActivityAt: ms('2026-05-10') });
    const c = contribution({ domain: 'film', inActivity: true, lastActivityAt: ms('2026-05-15') });
    const d = contribution({ domain: 'history', inActivity: true, lastActivityAt: ms('2026-05-14') });
    const ranked = rankFriendDomainsForBonus([a, b, c, d], 2);
    expect(ranked).toHaveLength(2);
  });

  it('orders presence sources most-recent-first for "{Name} and others" attribution', () => {
    const sam = contribution({ friendId: 'sam', friendDisplayName: 'Sam', domain: 'jazz', inActivity: true, lastActivityAt: ms('2026-05-01') });
    const robyn = contribution({ friendId: 'robyn', friendDisplayName: 'Robyn', domain: 'jazz', inActivity: true, lastActivityAt: ms('2026-05-20') });
    const [candidate] = rankFriendDomainsForBonus([sam, robyn], 1);
    expect(candidate.presenceSources.map((s) => s.displayName)).toEqual(['Robyn', 'Sam']);
  });

  it('drops generic subcategories and no-signal contributions', () => {
    const generic = contribution({ domain: 'general' });
    const noSignal = contribution({ domain: 'real', inTerritory: false, inActivity: false });
    const good = contribution({ domain: 'wagner operas' });
    const ranked = rankFriendDomainsForBonus([generic, noSignal, good], 5);
    expect(ranked.map((c) => c.domain)).toEqual(['wagner operas']);
  });

  it('returns nothing when limit <= 0', () => {
    expect(rankFriendDomainsForBonus([contribution()], 0)).toEqual([]);
  });
});
