import { describe, expect, it } from 'vitest';

import { domainKey } from '@/lib/knowledge/domain-key';
import {
  domainFrequencyWeight,
  domainWeeklyCap,
  dropCappedDomains,
  selectCustomDomainsForRound,
  weightedSampleWithoutReplacement,
} from '@/server/daily/domain-selection';

// Deterministic PRNG (mulberry32) so the statistical assertions below are
// reproducible — no Math.random, no flake.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const recent = (entries: Record<string, number>): Map<string, number> => {
  const m = new Map<string, number>();
  for (const [domain, n] of Object.entries(entries)) m.set(domainKey(domain), n);
  return m;
};

describe('dropCappedDomains (0121 admin generation cap)', () => {
  it('removes capped domains, matching by folded domain_key', () => {
    const capped = new Set([domainKey('Wagner’s Ring Cycle')]);
    // A case variant of the capped label must still be dropped (domainKey folds case).
    const out = dropCappedDomains(['Shakespearean Tragedy', 'WAGNER’S RING CYCLE', 'Jazz'], capped);
    expect(out).toEqual(['Shakespearean Tragedy', 'Jazz']);
  });

  it('returns everything when nothing is capped, and empties when all are capped (no fallback)', () => {
    expect(dropCappedDomains(['Opera', 'Jazz'], new Set())).toEqual(['Opera', 'Jazz']);
    // Deliberately no starvation fallback: capping the whole palette yields nothing.
    const allCapped = new Set(['Opera', 'Jazz'].map(domainKey));
    expect(dropCappedDomains(['Opera', 'Jazz'], allCapped)).toEqual([]);
  });
});

describe('weightedSampleWithoutReplacement', () => {
  it('draws distinct items, clamped to availability', () => {
    const items = ['a', 'b', 'c'].map((item) => ({ item, weight: 1 }));
    const out = weightedSampleWithoutReplacement(items, 10, seeded(1));
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
  });

  it('skips non-positive weights entirely', () => {
    const items = [
      { item: 'keep', weight: 1 },
      { item: 'zero', weight: 0 },
      { item: 'neg', weight: -3 },
    ];
    const out = weightedSampleWithoutReplacement(items, 5, seeded(2));
    expect(out).toEqual(['keep']);
  });

  it('favors heavier items over many seeded draws', () => {
    let heavyFirst = 0;
    const TRIALS = 2000;
    for (let i = 0; i < TRIALS; i += 1) {
      const out = weightedSampleWithoutReplacement(
        [
          { item: 'heavy', weight: 9 },
          { item: 'light', weight: 1 },
        ],
        1,
        seeded(i + 1),
      );
      if (out[0] === 'heavy') heavyFirst += 1;
    }
    // ~90% expected; assert a comfortable majority to avoid flake.
    expect(heavyFirst / TRIALS).toBeGreaterThan(0.8);
  });
});

describe('selectCustomDomainsForRound', () => {
  const freq: Record<string, string> = {
    Often: 'often',
    Sometimes: 'sometimes',
    BlueMoon: 'blue_moon',
  };
  const domains = ['Often', 'Sometimes', 'BlueMoon'];

  it('returns min(count, eligible) distinct domains', () => {
    const out = selectCustomDomainsForRound(domains, freq, new Map(), 2, seeded(7));
    expect(out).toHaveLength(2);
    expect(new Set(out).size).toBe(2);
    out.forEach((d) => expect(domains).toContain(d));
  });

  it('returns [] for an empty selection', () => {
    expect(selectCustomDomainsForRound([], freq, new Map(), 5)).toEqual([]);
  });

  it('honors frequency tags proportionally (often > sometimes > blue_moon)', () => {
    const picks: Record<string, number> = { Often: 0, Sometimes: 0, BlueMoon: 0 };
    const TRIALS = 3000;
    for (let i = 0; i < TRIALS; i += 1) {
      // Pick ONE domain per round so the share reflects the weighting.
      const [chosen] = selectCustomDomainsForRound(domains, freq, new Map(), 1, seeded(i + 1));
      picks[chosen] += 1;
    }
    expect(picks.Often).toBeGreaterThan(picks.Sometimes);
    expect(picks.Sometimes).toBeGreaterThan(picks.BlueMoon);
  });

  it('deprioritizes a domain mined hard this week (recency fold)', () => {
    // Two equal-frequency domains; one already has 4 recent questions.
    const f = { Fresh: 'sometimes', Hot: 'sometimes' };
    const recentCounts = recent({ Hot: 4 });
    let freshFirst = 0;
    const TRIALS = 2000;
    for (let i = 0; i < TRIALS; i += 1) {
      const [chosen] = selectCustomDomainsForRound(['Fresh', 'Hot'], f, recentCounts, 1, seeded(i + 1));
      if (chosen === 'Fresh') freshFirst += 1;
    }
    expect(freshFirst / TRIALS).toBeGreaterThan(0.6);
  });

  it('excludes a domain at its frequency-scaled weekly cap', () => {
    // 'sometimes' cap is 3. Sometimes-domain already has 3 → excluded; a fresh
    // 'often' domain is always chosen.
    const f = { Capped: 'sometimes', Open: 'often' };
    const recentCounts = recent({ Capped: 3 });
    for (let i = 0; i < 50; i += 1) {
      const out = selectCustomDomainsForRound(['Capped', 'Open'], f, recentCounts, 1, seeded(i + 1));
      expect(out).toEqual(['Open']);
    }
  });

  it('falls back to the full set when the cap would empty the palette', () => {
    // Every domain is over its cap → starvation guard returns the uncapped set.
    const f = { A: 'blue_moon', B: 'blue_moon' };
    const recentCounts = recent({ A: 2, B: 5 });
    const out = selectCustomDomainsForRound(['A', 'B'], f, recentCounts, 2, seeded(3));
    expect(new Set(out)).toEqual(new Set(['A', 'B']));
  });

  it('never picks a rested domain, even when it leaked into the selection', () => {
    // Stray-row case (prod 2026-07-12): a domain tagged 'resting' still present
    // in selectedDomains must never win a draw — no starvation fallback.
    const f = { Rested: 'resting', Open: 'blue_moon' };
    for (let i = 0; i < 100; i += 1) {
      const out = selectCustomDomainsForRound(['Rested', 'Open'], f, new Map(), 2, seeded(i + 1));
      expect(out).toEqual(['Open']);
    }
  });

  it('returns [] when every selected domain is rested (caller owns the fallback)', () => {
    const f = { A: 'resting', B: 'resting' };
    expect(selectCustomDomainsForRound(['A', 'B'], f, new Map(), 2, seeded(1))).toEqual([]);
  });

  it('keeps an often domain ahead of a fresh sometimes domain after a few serves (tier-scaled damping)', () => {
    // Regression for the flat 1/(1+recent) damping: Often with 3 recent
    // questions used to weigh 1.0 vs a fresh Sometimes at 2.0 and lose ~2:1.
    // Tier-scaled damping keeps it at 16/7 ≈ 2.3 vs 2.0 — a slight favorite.
    const f = { Often: 'often', FreshSometimes: 'sometimes' };
    const recentCounts = recent({ Often: 3 });
    let oftenFirst = 0;
    const TRIALS = 3000;
    for (let i = 0; i < TRIALS; i += 1) {
      const [chosen] = selectCustomDomainsForRound(
        ['Often', 'FreshSometimes'], f, recentCounts, 1, seeded(i + 1),
      );
      if (chosen === 'Often') oftenFirst += 1;
    }
    // Expected share 16/7 / (16/7 + 2) ≈ 53%; assert it at least holds even.
    expect(oftenFirst / TRIALS).toBeGreaterThan(0.5);
  });
});

describe('domainFrequencyWeight', () => {
  it('maps tags to weights, including a REAL zero for resting (not the default)', () => {
    expect(domainFrequencyWeight('often')).toBe(4);
    expect(domainFrequencyWeight('sometimes')).toBe(2);
    expect(domainFrequencyWeight('blue_moon')).toBe(1);
    // Regression: the old `||` fallback swallowed the 0 and rested domains
    // competed at 'sometimes' weight.
    expect(domainFrequencyWeight('resting')).toBe(0);
    expect(domainFrequencyWeight(undefined)).toBe(2);
    expect(domainFrequencyWeight('garbage')).toBe(2);
  });
});

describe('domainWeeklyCap', () => {
  it('maps tags to caps and defaults untagged to the flat cap', () => {
    expect(domainWeeklyCap('often')).toBe(7);
    expect(domainWeeklyCap('sometimes')).toBe(3);
    expect(domainWeeklyCap('blue_moon')).toBe(1);
    expect(domainWeeklyCap('resting')).toBe(0);
    expect(domainWeeklyCap(undefined)).toBe(5);
    expect(domainWeeklyCap('garbage')).toBe(5);
  });
});
