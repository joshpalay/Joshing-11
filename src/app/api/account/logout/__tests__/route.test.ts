import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, destroySessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  destroySessionMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
  destroySession: destroySessionMock,
}));

import { POST } from '@/app/api/account/logout/route';

describe('POST /api/account/logout (B-LOGOUT-CONFIRM-FIX-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockReset();
    destroySessionMock.mockReset();
  });

  it('destroys the session (clears joshing_session cookie) for an authed user', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 's1', userId: 'u1' });
    destroySessionMock.mockResolvedValueOnce(undefined);

    const res = await POST();

    expect(destroySessionMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('returns 401 and does not touch the session when there is no session', async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const res = await POST();

    expect(res.status).toBe(401);
    expect(destroySessionMock).not.toHaveBeenCalled();
  });
});
