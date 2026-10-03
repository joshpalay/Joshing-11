import { describe, expect, it } from 'vitest';
import { canReserve } from '../budget';

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
});
