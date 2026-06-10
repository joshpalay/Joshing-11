import { beforeAll, describe, expect, it } from 'vitest';

// BP-7 Phase-2 pure rules:
// - bankTierLadder: exact tier → one step UP → one step DOWN only at/above the
//   domain's floor. ±1 only. The floor is never violated (DO-NOT #3).
// - rankAndFilterBankCandidates: dud exclusion (empiricalCorrectRate === 0 ∧
//   nAnswered ≥ 5) + trust-rank ordering with shuffle-within-rank. An emptied
//   set returns [] so the caller falls through to generation, never to 503.
//
// Both modules import @/server/db at load; dummy URL + dynamic import is the
// repo convention for testing their pure exports.
let bankTierLadder: typeof import('@/server/daily/generate-questions').bankTierLadder;
let rankAndFilterBankCandidates: typeof import('@/server/db/queries/daily').rankAndFilterBankCandidates;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ bankTierLadder } = await import('@/server/daily/generate-questions'));
  ({ rankAndFilterBankCandidates } = await import('@/server/db/queries/daily'));
});

describe('bankTierLadder — floor-respecting tier-adjacent fallback (C5)', () => {
  it('exact → up → down when the floor allows the step down', () => {
    expect(bankTierLadder('moderate', 'accessible')).toEqual(['moderate', 'specialist', 'accessible']);
  });

  it('NEVER steps below the floor (declared territory, moderate floor)', () => {
    expect(bankTierLadder('moderate', 'moderate')).toEqual(['moderate', 'specialist']);
    expect(bankTierLadder('specialist', 'moderate')).toEqual(['specialist', 'moderate']);
  });

  it('clamps at the ladder edges (±1 only, no wrap)', () => {
    expect(bankTierLadder('accessible', 'accessible')).toEqual(['accessible', 'moderate']);
    expect(bankTierLadder('specialist', 'accessible')).toEqual(['specialist', 'moderate']);
  });

  it('property: starts exact, stays within ±1, and no DOWN-step ever lands below the floor', () => {
    const tiers = ['accessible', 'moderate', 'specialist'] as const;
    for (const target of tiers) {
      for (const floor of tiers) {
        const ladder = bankTierLadder(target, floor);
        const t = tiers.indexOf(target);
        const f = tiers.indexOf(floor);
        expect(ladder[0]).toBe(target);
        for (const tier of ladder) {
          const idx = tiers.indexOf(tier);
          expect(Math.abs(idx - t)).toBeLessThanOrEqual(1);
          // Down-steps (below the target) must be at or above the floor. The
          // exact target itself is the difficulty system's responsibility.
          if (idx < t) expect(idx).toBeGreaterThanOrEqual(f);
        }
      }
    }
  });
});

type Candidate = { id: string; trustTier: string; empiricalCorrectRate: number | null; nAnswered: number };

function candidate(id: string, trustTier: string, rate: number | null = null, n = 0): Candidate {
  return { id, trustTier, empiricalCorrectRate: rate, nAnswered: n };
}

describe('rankAndFilterBankCandidates — dud exclusion + trust ranking (Q5)', () => {
  it('excludes "nobody got it" stock (rate 0 with ≥5 answers) and counts it', () => {
    const { ranked, dudsExcluded } = rankAndFilterBankCandidates([
      candidate('dud', 'machine_verified', 0, 5),
      candidate('ok', 'machine_verified', 0.6, 10),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['ok']);
    expect(dudsExcluded).toBe(1);
  });

  it('does NOT exclude a 0-rate row with few answers, or an unplayed row', () => {
    const { ranked, dudsExcluded } = rankAndFilterBankCandidates([
      candidate('young', 'unverified', 0, 4),
      candidate('unplayed', 'unverified', null, 0),
    ]);
    expect(ranked).toHaveLength(2);
    expect(dudsExcluded).toBe(0);
  });

  it('returns an EMPTY set (fall-through to generation) when every row is a dud', () => {
    const { ranked, dudsExcluded } = rankAndFilterBankCandidates([
      candidate('dud1', 'machine_verified', 0, 7),
      candidate('dud2', 'human_validated', 0, 5),
    ]);
    expect(ranked).toEqual([]);
    expect(dudsExcluded).toBe(2);
  });

  it('prefers higher trust tiers, with unknown tiers ranked lowest', () => {
    const { ranked } = rankAndFilterBankCandidates([
      candidate('u', 'unverified'),
      candidate('a', 'author_confirmed'),
      candidate('m', 'machine_verified'),
      candidate('h', 'human_validated'),
      candidate('x', 'mystery_tier'),
    ]);
    const order = ranked.map((r) => r.id);
    expect(order[0]).toBe('a');
    expect(order[1]).toBe('h');
    expect(order[2]).toBe('m');
    expect(order.slice(3).sort()).toEqual(['u', 'x']);
  });

  it('shuffles within a rank without losing or reordering across ranks', () => {
    const rows = [
      candidate('m1', 'machine_verified'),
      candidate('m2', 'machine_verified'),
      candidate('m3', 'machine_verified'),
      candidate('h1', 'human_validated'),
    ];
    const { ranked } = rankAndFilterBankCandidates(rows);
    expect(ranked[0].id).toBe('h1');
    expect(ranked.slice(1).map((r) => r.id).sort()).toEqual(['m1', 'm2', 'm3']);
  });
});
