import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// D-REVIEW-RECOVERED-01 — the set-aside route is a thin, auth-guarded wrapper
// over the reversible soft-dismiss helpers. POST sets a question aside, DELETE
// restores it; both validate `questionId` and 401 without a session.

const { getSessionMock, setAsideMock, restoreMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' })),
  setAsideMock: vi.fn(async () => {}),
  restoreMock: vi.fn(async () => {}),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/recovered-questions', () => ({
  setAsideRecoveredQuestion: setAsideMock,
  restoreRecoveredQuestion: restoreMock,
}));

import { DELETE, POST } from '@/app/api/recovered/set-aside/route';

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  getSessionMock.mockResolvedValue({ userId: 'user-1', id: 's-1' });
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/recovered/set-aside', () => {
  it('401s without a session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST(req({ questionId: 'q-7' }));
    expect(res.status).toBe(401);
    expect(setAsideMock).not.toHaveBeenCalled();
  });

  it('400s on a malformed body', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(setAsideMock).not.toHaveBeenCalled();
  });

  it('sets the question aside for the viewer', async () => {
    const res = await POST(req({ questionId: 'q-7' }));
    expect(res.status).toBe(200);
    expect(setAsideMock).toHaveBeenCalledWith('user-1', 'q-7');
  });
});

describe('DELETE /api/recovered/set-aside', () => {
  it('401s without a session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await DELETE(req({ questionId: 'q-7' }));
    expect(res.status).toBe(401);
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it('restores the question for the viewer', async () => {
    const res = await DELETE(req({ questionId: 'q-7' }));
    expect(res.status).toBe(200);
    expect(restoreMock).toHaveBeenCalledWith('user-1', 'q-7');
  });
});
