import { describe, expect, it, vi } from 'vitest';

import { createServerTiming } from '@/server/lib/server-timing';

describe('createServerTiming', () => {
  it('serializes a single span in the proxy-compatible format', () => {
    const timing = createServerTiming();
    timing.add('feed', 12);
    expect(timing.toHeader()).toBe('feed;dur=12');
  });

  it('joins multiple spans with comma-space', () => {
    const timing = createServerTiming();
    timing.add('grade', 40);
    timing.add('total', 95);
    expect(timing.toHeader()).toBe('grade;dur=40, total;dur=95');
  });

  it('measures elapsed time from a start stamp', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_025);
    const startedAt = Date.now(); // 1000
    const timing = createServerTiming();
    timing.measure('queue', startedAt); // now() -> 1025
    expect(timing.toHeader()).toBe('queue;dur=25');
    now.mockRestore();
  });

  it('clamps negative or fractional durations to non-negative integers', () => {
    const timing = createServerTiming();
    timing.add('a', -5);
    timing.add('b', 12.7);
    expect(timing.toHeader()).toBe('a;dur=0, b;dur=13');
  });

  it('returns an empty string when no spans are recorded', () => {
    expect(createServerTiming().toHeader()).toBe('');
  });
});
