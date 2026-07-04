import { describe, expect, it } from 'vitest';

// Pure module — no DB, no side effects — so a static import is fine.
import {
  DEFAULT_MASTERY_THRESHOLD,
  MASTERY_FRACTION,
  isMastered,
  masteryProgress,
} from '@/server/knowledge/mastery-v2';

describe('masteryProgress', () => {
  it('is the clamped fraction of the threshold', () => {
    expect(masteryProgress(500, 1000)).toBe(0.5);
    expect(masteryProgress(1000, 1000)).toBe(1);
    expect(masteryProgress(2500, 1000)).toBe(1); // capped
  });

  it('is 0 for a non-positive threshold or negative points', () => {
    expect(masteryProgress(500, 0)).toBe(0);
    expect(masteryProgress(500, -10)).toBe(0);
    expect(masteryProgress(-5, 1000)).toBe(0);
  });
});

describe('isMastered — the 75% bar', () => {
  it('masters at or above 75% of the threshold', () => {
    expect(isMastered(750, 1000)).toBe(true); // exactly 75%
    expect(isMastered(900, 1000)).toBe(true);
    expect(isMastered(749, 1000)).toBe(false);
  });

  it('never masters on a non-positive threshold', () => {
    expect(isMastered(1000, 0)).toBe(false);
  });
});

describe('constants', () => {
  it('the bar is 75% and the default threshold is sane', () => {
    expect(MASTERY_FRACTION).toBe(0.75);
    expect(DEFAULT_MASTERY_THRESHOLD).toBeGreaterThan(0);
  });
});
