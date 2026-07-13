import { describe, expect, it } from 'vitest';

import { summarizeSupplyCoverage } from '@/server/daily/supply-coverage';
import type { DomainSupplyCoverageRow } from '@/server/db/queries/domain-depth-estimate';

function row(overrides: Partial<DomainSupplyCoverageRow>): DomainSupplyCoverageRow {
  return {
    domainKey: 'x',
    sampleLabel: 'X',
    estimatedQuestions: 100,
    manualEstimatedQuestions: null,
    confidence: 'high',
    shape: 'abstract_topic',
    basis: 'wp:sections',
    source: 'corpus',
    consecutiveDryRounds: 0,
    lastYieldAt: null,
    generationCappedAt: null,
    fandomHost: null,
    realized: 10,
    servable: 0,
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

  it('a manual override wins over the corpus estimate and re-derives the state', () => {
    // Shakespearean Tragedy: corpus said 27, realized 45 (raise_estimate);
    // the admin sets 90 → filling again, ratio recomputed against 90.
    const summary = summarizeSupplyCoverage([
      row({
        domainKey: 'shakespearean tragedy',
        sampleLabel: 'Shakespearean Tragedy',
        estimatedQuestions: 27,
        manualEstimatedQuestions: 90,
        realized: 45,
      }),
    ]);
    const entry = summary.entries[0];
    expect(entry.state).toBe('filling');
    expect(entry.estimatedQuestions).toBe(90);
    expect(entry.corpusEstimatedQuestions).toBe(27);
    expect(entry.manualEstimatedQuestions).toBe(90);
    expect(entry.ratio).toBeCloseTo(0.5);
  });

  it('an overridden row classifies at high confidence — a human anchor may alarm', () => {
    // Low-confidence resolution would normally suppress the discrepancy alarm;
    // the admin's number is trusted, so a dry shortfall against it DOES alarm.
    const summary = summarizeSupplyCoverage([
      row({
        realized: 5,
        consecutiveDryRounds: 5,
        confidence: 'low',
        estimatedQuestions: 30,
        manualEstimatedQuestions: 100,
      }),
    ]);
    expect(summary.entries[0].state).toBe('discrepancy');
    expect(summary.entries[0].confidence).toBe('high');
    expect(summary.discrepancies).toHaveLength(1);
  });

  it('a capped domain is kept out of the alarm list and counted separately', () => {
    // Same dry shortfall as a discrepancy, but the admin capped it: it stopped
    // generating on purpose, so it must not alarm — and it's tallied as capped.
    const summary = summarizeSupplyCoverage([
      row({
        domainKey: 'a',
        sampleLabel: 'Retired Franchise',
        realized: 3,
        consecutiveDryRounds: 5,
        generationCappedAt: new Date('2026-07-08T00:00:00Z'),
      }),
      row({ domainKey: 'b', sampleLabel: 'Live', realized: 3, consecutiveDryRounds: 5 }),
    ]);
    // The uncapped 'Live' still alarms; the capped one is suppressed.
    expect(summary.discrepancies.map((entry) => entry.label)).toEqual(['Live']);
    expect(summary.cappedCount).toBe(1);
    // State is still derived (orthogonal to the cap) — it just doesn't alarm.
    expect(summary.entries.find((entry) => entry.label === 'Retired Franchise')?.generationCapped).toBe(true);
  });

  it('empty coverage produces an empty, well-formed summary', () => {
    const summary = summarizeSupplyCoverage([]);
    expect(summary.entries).toHaveLength(0);
    expect(summary.discrepancies).toHaveLength(0);
    expect(summary.counts.discrepancy).toBe(0);
  });

  it('a stocked bank keeps a counter-dry domain out of the alarm list (backfill-supplied)', () => {
    // The 2026-07-13 false-alarm shape: dry counter climbed (only the JIT path
    // writes it) while the nightly backfill kept the domain stocked. Servable
    // stock ≥ the floor → classifies filling, no discrepancy.
    const summary = summarizeSupplyCoverage([
      row({
        domainKey: 'sesame street',
        sampleLabel: 'Sesame Street',
        realized: 15,
        estimatedQuestions: 1200,
        consecutiveDryRounds: 5,
        servable: 14,
      }),
    ]);
    expect(summary.entries[0].state).toBe('filling');
    expect(summary.discrepancies).toHaveLength(0);
  });

  it('flags a ceiling-clamped corpus estimate; a manual override is never clamped', () => {
    const summary = summarizeSupplyCoverage([
      // SIZE_CEIL is 1200: a corpus estimate at the ceiling means "at least".
      row({ domainKey: 'star trek', estimatedQuestions: 1200 }),
      row({ domainKey: 'wtc', estimatedQuestions: 198 }),
      // The same number set by hand is a human target, not a clamp.
      row({ domainKey: 'manual', estimatedQuestions: 1200, manualEstimatedQuestions: 1200 }),
    ]);
    const byKey = new Map(summary.entries.map((entry) => [entry.domainKey, entry]));
    expect(byKey.get('star trek')?.estimateClamped).toBe(true);
    expect(byKey.get('wtc')?.estimateClamped).toBe(false);
    expect(byKey.get('manual')?.estimateClamped).toBe(false);
  });
});
