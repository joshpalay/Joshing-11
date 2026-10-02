import { describe, expect, it } from 'vitest';

import { isOnMap } from '@/lib/knowledge/on-map';

describe('isOnMap', () => {
  it('keeps topics with points and topics the player added', () => {
    expect(isOnMap({ points: 10, isDeclared: false })).toBe(true);
    expect(isOnMap({ points: 0, isDeclared: true })).toBe(true);
  });

  it('drops a topic the player only answered in (no points, never added)', () => {
    // QA 2026-10-01 run 2: a declined bonus topic showed as "0 pts · Sometimes".
    expect(isOnMap({ points: 0, isDeclared: false })).toBe(false);
  });
});
