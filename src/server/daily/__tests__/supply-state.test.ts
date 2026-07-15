import { describe, expect, it } from 'vitest';

import { classifySupplyState } from '@/server/daily/supply-state';

const base = { realized: 10, estimatedQuestions: 100, confidence: 'high', consecutiveDryRounds: 0 };
const OPTS = { dryK: 3, nearRatio: 0.7, stockedFloor: 10 };

describe('classifySupplyState (the four arrows + gates)', () => {
  it('unsized: no estimate → never classified, never alarms', () => {
    expect(classifySupplyState({ ...base, estimatedQuestions: null }, OPTS)).toBe('unsized');
    expect(classifySupplyState({ ...base, estimatedQuestions: 0 }, OPTS)).toBe('unsized');
  });

  it('filling: yielding and below the estimate (the normal state)', () => {
    expect(classifySupplyState({ ...base, consecutiveDryRounds: 2 }, OPTS)).toBe('filling');
  });

  it('raise_estimate: still yielding PAST the estimate → co-calibration corrects upward', () => {
    // The measured Shakespearean Tragedy case: realized 45 > seed 27, not dry.
    expect(
      classifySupplyState(
        { realized: 45, estimatedQuestions: 27, confidence: 'high', consecutiveDryRounds: 0 },
        OPTS,
      ),
    ).toBe('raise_estimate');
  });

  it('soft_finite: dry at ~the estimate → believed complete, resting, re-probeable', () => {
    expect(
      classifySupplyState(
        { realized: 75, estimatedQuestions: 100, confidence: 'high', consecutiveDryRounds: 3 },
        OPTS,
      ),
    ).toBe('soft_finite');
    // dry AND past the estimate is completion, not a raise signal
    expect(
      classifySupplyState(
        { realized: 110, estimatedQuestions: 100, confidence: 'high', consecutiveDryRounds: 5 },
        OPTS,
      ),
    ).toBe('soft_finite');
  });

  it('discrepancy: dry FAR short of a high-confidence estimate → alarm, never finalize', () => {
    expect(
      classifySupplyState(
        { realized: 10, estimatedQuestions: 100, confidence: 'high', consecutiveDryRounds: 3 },
        OPTS,
      ),
    ).toBe('discrepancy');
  });

  it('confidence gate: the same dry shortfall at medium/low confidence rests instead of alarming', () => {
    for (const confidence of ['medium', 'low', null]) {
      expect(
        classifySupplyState(
          { realized: 10, estimatedQuestions: 100, confidence, consecutiveDryRounds: 3 },
          OPTS,
        ),
      ).toBe('soft_finite');
    }
  });

  it('dry threshold K is the boundary', () => {
    const shortfall = { realized: 10, estimatedQuestions: 100, confidence: 'high' };
    expect(classifySupplyState({ ...shortfall, consecutiveDryRounds: 2 }, OPTS)).toBe('filling');
    expect(classifySupplyState({ ...shortfall, consecutiveDryRounds: 3 }, OPTS)).toBe('discrepancy');
  });

  it('a stocked bank overrides the dry counter — the Sesame Street false alarm', () => {
    // Counter says dry (only the JIT path writes it) but the backfill keeps the
    // bank stocked: the domain is being supplied, so it classifies filling.
    const dryButStocked = {
      realized: 15,
      estimatedQuestions: 1200,
      confidence: 'high',
      consecutiveDryRounds: 5,
      servableStock: 12,
    };
    expect(classifySupplyState(dryButStocked, OPTS)).toBe('filling');
    // Below the floor the counter stands and the alarm still fires.
    expect(classifySupplyState({ ...dryButStocked, servableStock: 3 }, OPTS)).toBe('discrepancy');
    // Callers without a stock read keep the pure counter-driven behavior.
    expect(classifySupplyState({ ...dryButStocked, servableStock: null }, OPTS)).toBe('discrepancy');
  });

  it('stocked + past the estimate reads raise_estimate, not soft_finite', () => {
    expect(
      classifySupplyState(
        {
          realized: 110,
          estimatedQuestions: 100,
          confidence: 'high',
          consecutiveDryRounds: 5,
          servableStock: 40,
        },
        OPTS,
      ),
    ).toBe('raise_estimate');
  });
});
