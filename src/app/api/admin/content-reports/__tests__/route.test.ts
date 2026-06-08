import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextRequest } from 'next/server';

const { getSessionMock, isAdminUserMock, upholdMock, dismissMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({ userId: 'admin-1', id: 's-1' }) as { userId: string; id: string } | null),
  isAdminUserMock: vi.fn(() => true),
  upholdMock: vi.fn(async () => ({ ok: true, action: 'upheld', category: 'inappropriate', hardRemoved: true })),
  dismissMock: vi.fn(async () => ({ ok: true, action: 'dismissed', category: 'incorrect', hardRemoved: false })),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/auth/admin', () => ({ isAdminUser: isAdminUserMock }));
vi.mock('@/server/db/queries/content-reports', () => ({
  upholdReport: upholdMock,
  dismissReport: dismissMock,
}));

import { POST } from '@/app/api/admin/content-reports/route';

function post(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/admin/content-reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest);
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ userId: 'admin-1', id: 's-1' });
  isAdminUserMock.mockReturnValue(true);
});

describe('POST /api/admin/content-reports', () => {
  it('returns 404 (not 403) for an authenticated non-admin and takes no action', async () => {
    isAdminUserMock.mockReturnValue(false);
    const res = await post({ reportId: 'r1', action: 'uphold' });
    expect(res.status).toBe(404);
    expect(upholdMock).not.toHaveBeenCalled();
    expect(dismissMock).not.toHaveBeenCalled();
  });

  it('returns 404 for the unauthenticated', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await post({ reportId: 'r1', action: 'uphold' });
    expect(res.status).toBe(404);
  });

  it('upholds for an admin', async () => {
    const res = await post({ reportId: 'r1', action: 'uphold', reviewReason: 'bad' });
    expect(res.status).toBe(200);
    expect(upholdMock).toHaveBeenCalledWith('r1', 'bad');
  });

  it('dismisses for an admin', async () => {
    const res = await post({ reportId: 'r2', action: 'dismiss' });
    expect(res.status).toBe(200);
    expect(dismissMock).toHaveBeenCalledWith('r2', undefined);
  });

  it('rejects an invalid action', async () => {
    const res = await post({ reportId: 'r1', action: 'delete' });
    expect(res.status).toBe(400);
    expect(upholdMock).not.toHaveBeenCalled();
  });

  it('maps an already-resolved result to 409', async () => {
    upholdMock.mockResolvedValueOnce({ ok: false, reason: 'already_resolved' });
    const res = await post({ reportId: 'r1', action: 'uphold' });
    expect(res.status).toBe(409);
  });
});
