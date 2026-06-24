import { beforeEach, describe, expect, it, vi } from 'vitest';

const { destroySessionMock } = vi.hoisted(() => ({
  destroySessionMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({
  destroySession: destroySessionMock,
}));

import { POST } from '@/app/api/account/logout/route';

describe('POST /api/account/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    destroySessionMock.mockReset();
  });

  it('destroys the session (clears joshing_session cookie) for an authed user', async () => {
    destroySessionMock.mockResolvedValueOnce(undefined);

    const res = await POST();

    expect(destroySessionMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  // Idempotent: a "zombie" cookie (valid JWT signature, no DB session row)
  // resolves to no session, but logout must still clear the cookie so the user
  // can escape the signed-out-but-cookie-present trap. It must NOT 401.
  it('still clears the cookie and returns ok when there is no valid session', async () => {
    destroySessionMock.mockResolvedValueOnce(undefined);

    const res = await POST();

    expect(destroySessionMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
