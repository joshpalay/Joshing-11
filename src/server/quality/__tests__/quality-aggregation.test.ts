import { beforeAll, describe, expect, it } from 'vitest';

import type { ClusterStats } from '@/server/quality/quality-aggregation';

// quality-aggregation.ts → @/server/db, which throws at load without a connection
// string. The pure functions never touch the DB; dummy URL + dynamic import.
let mod: typeof import('@/server/quality/quality-aggregation');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/quality/quality-aggregation');
});

function cluster(over: Partial<ClusterStats>): ClusterStats {
  return {
    broadCategory: 'Literature',
    canonicalSubcategory: 'Spy School Books 1-6',
    sampleSize: 0,
    demoted: 0,
    unverifiable: 0,
    vetRejected: 0,
    critiqued: 0,
    ...over,
  };
}

describe('defectRate', () => {
  it('is (demoted + vetRejected) / sampleSize', () => {
    expect(mod.defectRate(cluster({ sampleSize: 10, demoted: 2, vetRejected: 1 }))).toBeCloseTo(0.3);
  });
  it('is 0 for an empty sample (no divide-by-zero)', () => {
    expect(mod.defectRate(cluster({ sampleSize: 0, demoted: 3 }))).toBe(0);
  });
});

describe('partitionByFloor — Decision C sample floor', () => {
  const clusters = [
    cluster({ canonicalSubcategory: 'big-clean', sampleSize: 10, demoted: 0 }),
    cluster({ canonicalSubcategory: 'big-dirty', sampleSize: 10, demoted: 4 }),
    cluster({ canonicalSubcategory: 'thin', sampleSize: 3, demoted: 2 }),
  ];

  it('excludes clusters below the floor from the eligible set', () => {
    const { eligible, belowFloor } = mod.partitionByFloor(clusters, 5);
    expect(eligible.map((c) => c.canonicalSubcategory)).not.toContain('thin');
    expect(belowFloor.map((c) => c.canonicalSubcategory)).toEqual(['thin']);
  });

  it('sorts eligible clusters by defect rate, worst first', () => {
    const { eligible } = mod.partitionByFloor(clusters, 5);
    expect(eligible.map((c) => c.canonicalSubcategory)).toEqual(['big-dirty', 'big-clean']);
  });
});

describe('renderQualityAggregationMarkdown', () => {
  const base = {
    periodStart: new Date('2026-06-01T00:00:00Z'),
    periodEnd: new Date('2026-07-01T00:00:00Z'),
    windowDays: 30,
    floor: 5,
    gates: [],
  };

  it('renders eligible clusters in a table and below-floor as watch', () => {
    const md = mod.renderQualityAggregationMarkdown({
      ...base,
      eligible: [cluster({ canonicalSubcategory: 'big-dirty', sampleSize: 10, demoted: 4, vetRejected: 1 })],
      belowFloor: [cluster({ canonicalSubcategory: 'thin', sampleSize: 3, demoted: 2 })],
    });
    expect(md).toContain('Eligible clusters');
    expect(md).toContain('big-dirty');
    expect(md).toMatch(/Watch.*below the 5-sample floor/);
    expect(md).toContain('thin');
    expect(md).toContain('50%'); // (4 demoted + 1 vetRejected) / 10
  });

  it('states plainly when nothing cleared the floor', () => {
    const md = mod.renderQualityAggregationMarkdown({ ...base, eligible: [], belowFloor: [] });
    expect(md).toMatch(/No cluster cleared the sample floor/);
  });

  it('renders gate drop rates and flags failed-open runs', () => {
    const md = mod.renderQualityAggregationMarkdown({
      ...base,
      eligible: [],
      belowFloor: [],
      gates: [
        { gate: 'quality', considered: 200, dropped: 14, failedOpen: 0 },
        { gate: 'factual', considered: 200, dropped: 8, failedOpen: 3 },
      ],
    });
    expect(md).toContain('Generation gates');
    expect(md).toContain('| quality | 200 | 14 | 7.0% | 0 |');
    expect(md).toContain('⚠ 3');
    expect(md).toMatch(/Check these gates: factual/);
  });

  it('flags a fail-open LLM gate with a zero drop rate across a real sample', () => {
    const md = mod.renderQualityAggregationMarkdown({
      ...base,
      eligible: [],
      belowFloor: [],
      gates: [
        { gate: 'quality', considered: 120, dropped: 0, failedOpen: 0 },
        // Deterministic gate at zero is normal — must NOT be flagged.
        { gate: 'answer_leak', considered: 120, dropped: 0, failedOpen: 0 },
      ],
    });
    expect(md).toMatch(/Check these gates: quality(?!.*answer_leak)/);
  });

  it('omits the gates section when no counters exist (un-migrated or quiet week)', () => {
    const md = mod.renderQualityAggregationMarkdown({ ...base, eligible: [], belowFloor: [] });
    expect(md).not.toContain('Generation gates');
  });
});
