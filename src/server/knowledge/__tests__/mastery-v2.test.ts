import { describe, expect, it } from 'vitest';

// Pure module — no DB, no side effects — so a static import is fine (unlike the
// parent-mastery test, which dynamic-imports because that module pulls in db).
import {
  DEFAULT_POINTS_PER_WEIGHT,
  PARENT_MASTERY_COVERAGE,
  computeLeafBar,
  leafMastered,
  leafProgress,
  parentCoverage,
  parentCoverageFromLeaves,
} from '@/server/knowledge/mastery-v2';

describe('leafProgress', () => {
  it('is the clamped fraction of the bar', () => {
    expect(leafProgress(50, 100)).toBe(0.5);
    expect(leafProgress(100, 100)).toBe(1);
    expect(leafProgress(250, 100)).toBe(1); // capped
  });

  it('is 0 for a non-positive bar or negative earnings', () => {
    expect(leafProgress(50, 0)).toBe(0);
    expect(leafProgress(50, -10)).toBe(0);
    expect(leafProgress(-5, 100)).toBe(0);
  });
});

describe('leafMastered', () => {
  it('is true only at or above a positive bar', () => {
    expect(leafMastered(100, 100)).toBe(true);
    expect(leafMastered(120, 100)).toBe(true);
    expect(leafMastered(99, 100)).toBe(false);
    expect(leafMastered(100, 0)).toBe(false); // no bar to clear
  });
});

describe('computeLeafBar', () => {
  it('scales the bar by weight × pointsPerWeight', () => {
    expect(computeLeafBar({ weight: 10 })).toBe(10 * DEFAULT_POINTS_PER_WEIGHT);
    expect(computeLeafBar({ weight: 3, pointsPerWeight: 50 })).toBe(150);
  });

  it('a non-positive weight yields a 0 bar', () => {
    expect(computeLeafBar({ weight: 0 })).toBe(0);
    expect(computeLeafBar({ weight: -4 })).toBe(0);
  });

  it('CAPS the bar at reachable supply so a deep-but-thin domain stays masterable', () => {
    // Deep topic (weight 40 → depthBar 4000) but only 300 points of supply exist.
    expect(computeLeafBar({ weight: 40, reachableSupplyPoints: 300 })).toBe(300);
    // Supply above the depth demand does not raise the bar.
    expect(computeLeafBar({ weight: 2, reachableSupplyPoints: 5000 })).toBe(200);
    // No cap when supply is omitted / Infinity.
    expect(computeLeafBar({ weight: 40, reachableSupplyPoints: Infinity })).toBe(4000);
    expect(computeLeafBar({ weight: 40 })).toBe(4000);
  });
});

describe('parentCoverage — smooth (default)', () => {
  it('is the depth-weighted mean of leaf progress', () => {
    const { coverage, isMaster } = parentCoverage([
      { weight: 1, progress: 1 },
      { weight: 1, progress: 0 },
    ]);
    expect(coverage).toBe(0.5); // 1/2
    expect(isMaster).toBe(false);
  });

  it('weights a big leaf more than a small one', () => {
    // Only the big leaf covered: 30/50 = 0.6 — not yet master.
    expect(
      parentCoverage([
        { weight: 30, progress: 1 },
        { weight: 10, progress: 0 },
        { weight: 10, progress: 0 },
      ]).coverage,
    ).toBeCloseTo(0.6);
    // Add a second covered leaf: 40/50 = 0.8 — master.
    const withSecond = parentCoverage([
      { weight: 30, progress: 1 },
      { weight: 10, progress: 1 },
      { weight: 10, progress: 0 },
    ]);
    expect(withSecond.coverage).toBeCloseTo(0.8);
    expect(withSecond.isMaster).toBe(true);
  });

  it('exactly 75% masters (≥, not >)', () => {
    expect(parentCoverage([{ weight: 3, progress: 1 }, { weight: 1, progress: 0 }]).isMaster).toBe(
      true,
    ); // 3/4 = 0.75
  });

  it('empty or zero-weight parents read as 0 coverage, not-master', () => {
    expect(parentCoverage([])).toEqual({ coverage: 0, isMaster: false });
    expect(parentCoverage([{ weight: 0, progress: 1 }])).toEqual({ coverage: 0, isMaster: false });
  });
});

describe('parentCoverage — binary contribution', () => {
  it('only FULLY mastered leaves count their weight', () => {
    const smooth = parentCoverage(
      [
        { weight: 1, progress: 0.9 },
        { weight: 1, progress: 0.9 },
      ],
      { contribution: 'smooth' },
    );
    expect(smooth.coverage).toBeCloseTo(0.9); // partial counts

    const binary = parentCoverage(
      [
        { weight: 1, progress: 0.9 },
        { weight: 1, progress: 0.9 },
      ],
      { contribution: 'binary' },
    );
    expect(binary.coverage).toBe(0); // neither is fully mastered → nothing counts
  });
});

describe('the King Lear scenario (spec §The problem)', () => {
  it('mastering one leaf never masters the whole parent unless it is ≥75% of the weight', () => {
    // Tragedy's leaves, weighted by breadth. King Lear fully mastered, rest untouched.
    const tragedy = parentCoverageFromLeaves([
      { weight: 15, earnedPoints: 400, leafBar: 300 }, // King Lear — mastered (progress capped to 1)
      { weight: 20, earnedPoints: 0, leafBar: 400 }, // Hamlet
      { weight: 12, earnedPoints: 0, leafBar: 300 }, // Macbeth
      { weight: 10, earnedPoints: 0, leafBar: 250 }, // Othello
    ]);
    // 15 / 57 ≈ 0.26 — a real King Lear master, honestly NOT a Tragedy master.
    expect(tragedy.coverage).toBeCloseTo(15 / 57, 5);
    expect(tragedy.isMaster).toBe(false);
  });

  it('the leaf itself is (and stays) mastered regardless of the parent verdict', () => {
    expect(leafMastered(400, 300)).toBe(true);
  });
});

describe('constants', () => {
  it('the parent bar is 75%', () => {
    expect(PARENT_MASTERY_COVERAGE).toBe(0.75);
  });
});
