import { describe, expect, it, vi } from 'vitest';

import { createServerTiming, logServerTiming, timeServerWork } from '@/server/lib/server-timing';

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

  it('exposes spans as a `${name}_ms` metrics map for structured logging', () => {
    const timing = createServerTiming();
    timing.add('grade', 40);
    timing.add('total', 95);
    expect(timing.toMetrics()).toEqual({ grade_ms: 40, total_ms: 95 });
  });

  it('returns an empty metrics map when no spans are recorded', () => {
    expect(createServerTiming().toMetrics()).toEqual({});
  });
});

describe('logServerTiming', () => {
  it('emits a single `[perf]` line with route, metrics, and extra fields', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const timing = createServerTiming();
    timing.add('feed', 12);
    logServerTiming('feed', timing, { filter: 'all', items: 20 });
    expect(info).toHaveBeenCalledWith('[perf]', {
      route: 'feed',
      feed_ms: 12,
      filter: 'all',
      items: 20,
    });
    info.mockRestore();
  });

  it('never throws when logging fails (telemetry only)', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('log sink down');
    });
    expect(() => logServerTiming('feed', createServerTiming())).not.toThrow();
    info.mockRestore();
  });
});

describe('timeServerWork', () => {
  it('returns the work result and emits one `[perf]` line for the span', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const result = await timeServerWork('home/todays-five', 'todays_five', async () => 'payload');
    expect(result).toBe('payload');
    expect(info).toHaveBeenCalledTimes(1);
    const [tag, fields] = info.mock.calls[0];
    expect(tag).toBe('[perf]');
    expect(fields).toMatchObject({ route: 'home/todays-five' });
    expect(fields).toHaveProperty('todays_five_ms');
    info.mockRestore();
  });

  it('still logs the span and re-throws when work rejects', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const boom = new Error('query failed');
    await expect(
      timeServerWork('home/from-friends', 'home_edition', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(info).toHaveBeenCalledWith('[perf]', expect.objectContaining({ route: 'home/from-friends' }));
    info.mockRestore();
  });
});
