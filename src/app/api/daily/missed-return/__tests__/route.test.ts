import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSessionMock,
  setMissedReturnEnabledMock,
  dismissMissedReturnMock,
  reinstateMissedReturnMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  setMissedReturnEnabledMock: vi.fn(),
  dismissMissedReturnMock: vi.fn(),
  reinstateMissedReturnMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/missed-return', () => ({
  setMissedReturnEnabled: setMissedReturnEnabledMock,
}));
vi.mock('@/server/db/queries/missed-return-dismissed', () => ({
  dismissMissedReturn: dismissMissedReturnMock,
  reinstateMissedReturn: reinstateMissedReturnMock,
}));

import { PATCH } from '@/app/api/daily/missed-return/settings/route';
import { DELETE, POST } from '@/app/api/daily/missed-return/dismiss/route';

function req(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ userId: 'user-1' });
});

describe('PATCH /api/daily/missed-return/settings — the §7-B1 toggle', () => {
  it('turns the feature off', async () => {
    const res = await PATCH(req('/api/daily/missed-return/settings', 'PATCH', { enabled: false }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
    expect(setMissedReturnEnabledMock).toHaveBeenCalledWith('user-1', false);
  });

  it('turns it back on', async () => {
    const res = await PATCH(req('/api/daily/missed-return/settings', 'PATCH', { enabled: true }) as never);
    expect(res.status).toBe(200);
    expect(setMissedReturnEnabledMock).toHaveBeenCalledWith('user-1', true);
  });

  it('rejects a non-boolean rather than coercing it', async () => {
    const res = await PATCH(req('/api/daily/missed-return/settings', 'PATCH', { enabled: 'yes' }) as never);
    expect(res.status).toBe(400);
    expect(setMissedReturnEnabledMock).not.toHaveBeenCalled();
  });

  it('401s without a session', async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await PATCH(req('/api/daily/missed-return/settings', 'PATCH', { enabled: false }) as never);
    expect(res.status).toBe(401);
    expect(setMissedReturnEnabledMock).not.toHaveBeenCalled();
  });
});

describe('/api/daily/missed-return/dismiss — §7-C dismiss and immediate undo', () => {
  it('dismisses for the session user, never a client-supplied one', async () => {
    const res = await POST(
      req('/api/daily/missed-return/dismiss', 'POST', { questionId: 'q1', userId: 'someone-else' }) as never,
    );
    expect(res.status).toBe(200);
    expect(dismissMissedReturnMock).toHaveBeenCalledWith('user-1', 'q1');
  });

  it('DELETE undoes the dismiss', async () => {
    const res = await DELETE(req('/api/daily/missed-return/dismiss', 'DELETE', { questionId: 'q1' }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restored: true });
    expect(reinstateMissedReturnMock).toHaveBeenCalledWith('user-1', 'q1');
  });

  it('a dismiss writes ONLY the dismiss — never a mastery/points side effect (§5)', async () => {
    await POST(req('/api/daily/missed-return/dismiss', 'POST', { questionId: 'q1' }) as never);
    expect(dismissMissedReturnMock).toHaveBeenCalledTimes(1);
    expect(reinstateMissedReturnMock).not.toHaveBeenCalled();
  });

  it('rejects a missing questionId', async () => {
    const res = await POST(req('/api/daily/missed-return/dismiss', 'POST', {}) as never);
    expect(res.status).toBe(400);
    expect(dismissMissedReturnMock).not.toHaveBeenCalled();
  });

  it('401s both verbs without a session', async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await POST(req('/api/daily/missed-return/dismiss', 'POST', { questionId: 'q1' }) as never)).status).toBe(401);
    expect((await DELETE(req('/api/daily/missed-return/dismiss', 'DELETE', { questionId: 'q1' }) as never)).status).toBe(401);
    expect(dismissMissedReturnMock).not.toHaveBeenCalled();
    expect(reinstateMissedReturnMock).not.toHaveBeenCalled();
  });
});
