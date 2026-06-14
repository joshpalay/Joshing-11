import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logoutAndRedirect } from '@/components/profile/settings/AccountActions';

describe('logoutAndRedirect (B-LOGOUT-CONFIRM-FIX-01)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to /api/account/logout (the route that clears joshing_session) and redirects to /login', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const navigate = vi.fn();

    await logoutAndRedirect(navigate);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/account/logout');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/login');
  });

  it('treats 401 (session already gone) as a successful logout and still redirects', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );
    const navigate = vi.fn();

    await logoutAndRedirect(navigate);

    expect(navigate).toHaveBeenCalledExactlyOnceWith('/login');
  });

  it('throws and does NOT redirect when the logout request fails server-side', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 500 }),
    );
    const navigate = vi.fn();

    await expect(logoutAndRedirect(navigate)).rejects.toThrow('Could not log out.');
    expect(navigate).not.toHaveBeenCalled();
  });
});
