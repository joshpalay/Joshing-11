import { describe, expect, it, vi } from 'vitest';

import { CEREMONY_VIEWED_MAX_ATTEMPTS, markCeremonyViewed } from '../mark-ceremony-viewed';

function response(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as unknown as Response;
}

const noDelay = () => Promise.resolve();

describe('markCeremonyViewed', () => {
  it('resolves true on first success without retrying', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200));

    const ok = await markCeremonyViewed('c1', { fetchImpl, delayImpl: noDelay });

    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/api/ceremony/c1/viewed', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('retries a transient 500 then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(200));

    const ok = await markCeremonyViewed('c1', { fetchImpl, delayImpl: noDelay });

    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a network-level failure then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response(200));

    const ok = await markCeremonyViewed('c1', { fetchImpl, delayImpl: noDelay });

    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops immediately on a deterministic 403 without retrying', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(403));

    const ok = await markCeremonyViewed('c1', { fetchImpl, delayImpl: noDelay });

    expect(ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resolves false once every attempt is spent on transient failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(503));

    const ok = await markCeremonyViewed('c1', { fetchImpl, delayImpl: noDelay });

    expect(ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(CEREMONY_VIEWED_MAX_ATTEMPTS);
  });
});
