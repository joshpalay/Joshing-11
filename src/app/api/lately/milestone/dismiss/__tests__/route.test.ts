import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Dismiss-as-answered — the milestone dismiss route is a thin, auth-guarded
// wrapper over the reversible neutral soft-dismiss helpers. POST dismisses a
// question, DELETE undoes it; both validate `questionId`, 401 without a session,
// and 404 when the question isn't in the viewer's own From Friends milestones
// (authorization by construction via getSeededPlayQuestions, mirroring the
// milestone answer route). Crucially, neither writes anything to mastery/points.

const { getSessionMock, getSeededPlayQuestionsMock, dismissMock, reinstateMock } = vi.hoisted(
  () => ({
    getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' })),
    getSeededPlayQuestionsMock: vi.fn(async () => [{ questionId: 'q-7' }]),
    dismissMock: vi.fn(async () => {}),
    reinstateMock: vi.fn(async () => {}),
  }),
);

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/lately', () => ({
  getSeededPlayQuestions: getSeededPlayQuestionsMock,
  dismissMilestoneQuestion: dismissMock,
  reinstateMilestoneQuestion: reinstateMock,
}));

import { DELETE, POST } from '@/app/api/lately/milestone/dismiss/route';

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  getSessionMock.mockResolvedValue({ userId: 'user-1', id: 's-1' });
  getSeededPlayQuestionsMock.mockResolvedValue([{ questionId: 'q-7' }]);
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/lately/milestone/dismiss', () => {
  it('401s without a session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST(req({ questionId: 'q-7' }));
    expect(res.status).toBe(401);
    expect(dismissMock).not.toHaveBeenCalled();
  });

  it('400s on a malformed body', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(dismissMock).not.toHaveBeenCalled();
  });

  it('404s when the question is not in the viewer’s own milestones', async () => {
    getSeededPlayQuestionsMock.mockResolvedValueOnce([]);
    const res = await POST(req({ questionId: 'not-mine' }));
    expect(res.status).toBe(404);
    expect(dismissMock).not.toHaveBeenCalled();
  });

  it('dismisses the question for the viewer (neutral — no mastery write)', async () => {
    const res = await POST(req({ questionId: 'q-7' }));
    expect(res.status).toBe(200);
    expect(dismissMock).toHaveBeenCalledWith('user-1', 'q-7');
  });
});

describe('DELETE /api/lately/milestone/dismiss', () => {
  it('401s without a session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await DELETE(req({ questionId: 'q-7' }));
    expect(res.status).toBe(401);
    expect(reinstateMock).not.toHaveBeenCalled();
  });

  it('undoes the dismiss for the viewer', async () => {
    const res = await DELETE(req({ questionId: 'q-7' }));
    expect(res.status).toBe(200);
    expect(reinstateMock).toHaveBeenCalledWith('user-1', 'q-7');
  });
});
