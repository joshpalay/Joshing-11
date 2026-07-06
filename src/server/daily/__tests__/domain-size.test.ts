import { describe, expect, it } from 'vitest';

import { depthToTargetCount } from '@/server/daily/domain-size';

// Explicit opts so the curve is tested independent of env knobs.
const OPTS = { coefficient: 2, min: 12, max: 200 };

describe('depthToTargetCount — depth (1-10) → target distinct-question count', () => {
  it('matches the agreed anchors (count ≈ 2·depth²)', () => {
    expect(depthToTargetCount(3, OPTS)).toBe(18); // Spy School (thin) → graduate fast
    expect(depthToTargetCount(4, OPTS)).toBe(32);
    expect(depthToTargetCount(6, OPTS)).toBe(72);
    expect(depthToTargetCount(8, OPTS)).toBe(128); // Star Wars (deep) → long runway
  });

  it('clamps to the min for shallow topics', () => {
    expect(depthToTargetCount(1, OPTS)).toBe(12); // 2·1 = 2 → floored to 12
    expect(depthToTargetCount(2, OPTS)).toBe(12); // 2·4 = 8 → floored to 12
  });

  it('clamps to the max for the deepest topics', () => {
    expect(depthToTargetCount(10, OPTS)).toBe(200); // 2·100 = 200 (at cap)
    expect(depthToTargetCount(10, { ...OPTS, coefficient: 3 })).toBe(200); // 300 → capped
  });

  it('rounds the depth and clamps out-of-range inputs', () => {
    expect(depthToTargetCount(3.4, OPTS)).toBe(18); // rounds to 3
    expect(depthToTargetCount(0, OPTS)).toBe(12); // clamped up to depth 1 → 2 → floor 12
    expect(depthToTargetCount(99, OPTS)).toBe(200); // clamped down to depth 10
  });

  it('scales the whole curve when the coefficient is raised (the "expand later" lever)', () => {
    expect(depthToTargetCount(3, { ...OPTS, coefficient: 3 })).toBe(27); // 3·9
    expect(depthToTargetCount(8, { ...OPTS, coefficient: 3 })).toBe(192); // 3·64
  });
});
