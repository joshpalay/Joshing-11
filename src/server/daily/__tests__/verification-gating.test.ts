import { afterEach, describe, expect, it } from 'vitest';

import {
  FRIEND_FACING_TIERS,
  SELF_PRACTICE_TIERS,
  applyTierGate,
  isTierGatingEnabled,
  type TrustTier,
} from '@/server/daily/verification-gating';

type Row = { id: string; tier: TrustTier };
const rows: Row[] = [
  { id: 'a', tier: 'unverified' },
  { id: 'b', tier: 'machine_verified' },
  { id: 'c', tier: 'human_validated' },
  { id: 'd', tier: 'author_confirmed' },
];
const tierOf = (r: Row) => r.tier;

afterEach(() => {
  delete process.env.VERIFICATION_TIER_GATING_ENABLED;
});

describe('isTierGatingEnabled', () => {
  it('defaults OFF', () => {
    expect(isTierGatingEnabled()).toBe(false);
  });
  it('reads truthy env values', () => {
    for (const v of ['true', '1', 'yes', 'on']) {
      process.env.VERIFICATION_TIER_GATING_ENABLED = v;
      expect(isTierGatingEnabled()).toBe(true);
    }
    process.env.VERIFICATION_TIER_GATING_ENABLED = 'false';
    expect(isTierGatingEnabled()).toBe(false);
  });
});

describe('applyTierGate — shadow (flag off)', () => {
  it('serves ALL rows unchanged but reports the would-filter count', () => {
    const r = applyTierGate('self-practice/bank', rows, tierOf, SELF_PRACTICE_TIERS);
    expect(r.enforced).toBe(false);
    expect(r.rows).toHaveLength(4); // unchanged — today's behavior preserved
    expect(r.wouldFilter).toBe(1); // the unverified row would be dropped
    expect(r.candidateCount).toBe(4);
  });
});

describe('applyTierGate — enforcing (flag on)', () => {
  it('drops below-bar rows for self-practice (≥ machine_verified)', () => {
    process.env.VERIFICATION_TIER_GATING_ENABLED = 'true';
    const r = applyTierGate('self-practice/bank', rows, tierOf, SELF_PRACTICE_TIERS);
    expect(r.enforced).toBe(true);
    expect(r.rows.map((x) => x.id)).toEqual(['b', 'c', 'd']);
  });

  it('drops everything below human_validated for friend-facing', () => {
    process.env.VERIFICATION_TIER_GATING_ENABLED = 'true';
    const r = applyTierGate('friend-facing/authored', rows, tierOf, FRIEND_FACING_TIERS);
    expect(r.rows.map((x) => x.id)).toEqual(['c', 'd']);
    expect(r.wouldFilter).toBe(2);
  });
});

describe('tier bands', () => {
  it('self-practice excludes only unverified; friend-facing is the higher pair', () => {
    expect(SELF_PRACTICE_TIERS).not.toContain('unverified');
    expect(SELF_PRACTICE_TIERS).toContain('machine_verified');
    expect(FRIEND_FACING_TIERS).toEqual(['human_validated', 'author_confirmed']);
  });
});
