import { describe, expect, it } from 'vitest';
import { canReserve, unrelatedUncertainReserveUsd } from '../budget';

describe('Cassian lifetime and first-run budget', () => {
  it('allows a call only when both ceilings retain headroom', () => {
    expect(canReserve({ lifetimeSpent: 5, lifetimeReserved: 1, runSpent: 2,
      runReserved: 0, requested: 2 })).toBe(true);
    expect(canReserve({ lifetimeSpent: 8.5, lifetimeReserved: 0.5, runSpent: 0,
      runReserved: 0, requested: 1.01 })).toBe(false);
    expect(canReserve({ lifetimeSpent: 2, lifetimeReserved: 0, runSpent: 3.5,
      runReserved: 0, requested: 0.51 })).toBe(false);
  });

  it('counts uncertain reservations and rejects invalid or zero prices', () => {
    expect(canReserve({ lifetimeSpent: 2, lifetimeReserved: 7.5, runSpent: 0,
      runReserved: 0, requested: 0.6 })).toBe(false);
    for (const requested of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(canReserve({ lifetimeSpent: 0, lifetimeReserved: 0, runSpent: 0,
        runReserved: 0, requested })).toBe(false);
    }
  });
  it('keeps carried uncertainty inside the lifetime ceiling for new runs', () => {
    expect(canReserve({ lifetimeSpent: 9.84, lifetimeReserved: 0.02, runSpent: 0,
      runReserved: 0, requested: 0.15, runCap: 0.75 })).toBe(false);
    expect(canReserve({ lifetimeSpent: 9.83, lifetimeReserved: 0.02, runSpent: 0,
      runReserved: 0, requested: 0.15, runCap: 0.75 })).toBe(true);
  });
  it('only classifies matching uncertainty from a different halted run as carryable', () => {
    const failed = { id: 'failed', status: 'halted', reservedUsd: 0.02,
      calls: { step: { status: 'uncertain' as const, reservedUsd: 0.02, at: 'before' } } };
    expect(unrelatedUncertainReserveUsd([failed], 'new')).toBe(0.02);
    expect(unrelatedUncertainReserveUsd([failed], 'failed')).toBe(0);
    expect(unrelatedUncertainReserveUsd([{ ...failed, status: 'active' }], 'new')).toBe(0);
    expect(unrelatedUncertainReserveUsd([{ ...failed, reservedUsd: 0.03 }], 'new')).toBe(0);
    expect(unrelatedUncertainReserveUsd([{ ...failed, calls: { step: { ...failed.calls.step, status: 'reserved' } } }], 'new')).toBe(0);
    expect(unrelatedUncertainReserveUsd([{ ...failed, calls: {} }], 'new')).toBe(0);
    expect(unrelatedUncertainReserveUsd([{ ...failed, reservedUsd: NaN }], 'new')).toBe(0);
  });
});
