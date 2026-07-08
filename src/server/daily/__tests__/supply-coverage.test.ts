import { describe, expect, it } from 'vitest';

import { summarizeSupplyCoverage } from '@/server/daily/supply-coverage';
import type { DomainSupplyCoverageRow } from '@/server/db/queries/domain-depth-estimate';

function row(overrides: Partial<DomainSupplyCoverageRow>): DomainSupplyCoverageRow {
  return {
    domainKey: 'x',
    sampleLabel: 'X',
    estimatedQuestions: 100,
    confidence: 'high',
    shape: 'abstract_topic',
    basis: 'wp:sections',
    source: 'corpus',
    consecutiveDryRounds: 0,
    lastYieldAt: null,
    realized: 10,
    ...overrides,
  };
}

describe('summarizeSupplyCoverage (the shared #5 surface summary)', () => {
  it('classifies, counts, and sorts discrepancies worst-coverage-first', () => {
    const summary = summarizeSupplyCoverage([
      row({ domainKey: 'a', sampleLabel: 'Hamlet', realized: 30, consecutiveDryRounds: 5 }),
      row({ domainKey: 'b', sampleLabel: 'Wallace Stevens', realized: 3, consecutiveDryRounds: 5 }),
      row({ domainKey: 'c', sampleLabel: 'Filling', realized: 10, consecutiveDryRounds: 0 }),
      row({
        domainKey: 'd',
        sampleLabel: 'Shakespearean Tragedy',
        realized: 45,
        estimatedQuestions: 27,
      }),
      row({ domainKey: 'e', sampleLabel: 'Bespoke', estimatedQuestions: null }),
      row({
        domainKey: 'f',
        sampleLabel: 'Wagner',
        realized: 80,
        consecutiveDryRounds: 5,
      }),
    ]);

    expect(summary.counts).toEqual({
      discrepancy: 2,
      raise_estimate: 1,
      filling: 1,
      soft_finite: 1,
      unsized: 1,
    });
    // Worst coverage first: Wallace Stevens (3%) before Hamlet (30%).
    expect(summary.discrepancies.map((entry) => entry.label)).toEqual([
      'Wallace Stevens',
      'Hamlet',
    ]);
    expect(summary.raiseEstimates.map((entry) => entry.label)).toEqual([
      'Shakespearean Tragedy',
    ]);
    // Ratio is computed for sized rows, null for unsized.
    expect(summary.discrepancies[0].ratio).toBeCloseTo(0.03);
    expect(summary.entries.find((entry) => entry.label === 'Bespoke')?.ratio).toBeNull();
  });

  it('a dry shortfall at low confidence never lands in the alarm list', () => {
    const summary = summarizeSupplyCoverage([
      row({ domainKey: 'a', realized: 3, consecutiveDryRounds: 5, confidence: 'low' }),
    ]);
    expect(summary.discrepancies).toHaveLength(0);
    expect(summary.counts.soft_finite).toBe(1);
  });

  it('empty coverage produces an empty, well-formed summary', () => {
    const summary = summarizeSupplyCoverage([]);
    expect(summary.entries).toHaveLength(0);
    expect(summary.discrepancies).toHaveLength(0);
    expect(summary.counts.discrepancy).toBe(0);
  });
});
