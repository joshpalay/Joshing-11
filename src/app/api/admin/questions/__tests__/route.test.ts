import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextRequest } from 'next/server';

// B-ADMIN-QUESTIONS-OVERVIEW-01 Phase 4 — mutation route tests. The gate is
// re-checked on the SERVER for every mutation (never trust the client); non-admins
// (and the unauthenticated) get 404, not 403 — the route's existence is hidden.

const { getSessionMock, isAdminUserMock, editMock, deleteMock, restoreMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<() => Promise<{ userId: string } | null>>(),
  isAdminUserMock: vi.fn<(userId: string | null | undefined) => boolean>(),
  editMock: vi.fn(async () => ({ ok: true })),
  deleteMock: vi.fn(async () => ({ ok: true })),
  restoreMock: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/auth/admin', () => ({ isAdminUser: isAdminUserMock }));
vi.mock('@/server/db/queries/admin-questions', () => ({
  adminEditQuestion: editMock,
  adminSoftDeleteQuestion: deleteMock,
  adminRestoreQuestion: restoreMock,
}));

import { POST } from '@/app/api/admin/questions/route';

function post(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/admin/questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest);
}

beforeEach(() => {
  vi.clearAllMocks();
  editMock.mockResolvedValue({ ok: true });
  deleteMock.mockResolvedValue({ ok: true });
  restoreMock.mockResolvedValue({ ok: true });
});

describe('admin questions mutation route — gating', () => {
  it('404s for the unauthenticated and runs no mutation', async () => {
    getSessionMock.mockResolvedValue(null);
    isAdminUserMock.mockReturnValue(false);

    const res = await post({ action: 'delete', id: 'q1' });
    expect(res.status).toBe(404);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('404s for an authenticated non-admin and runs no mutation', async () => {
    getSessionMock.mockResolvedValue({ userId: 'nope' });
    isAdminUserMock.mockReturnValue(false);

    const res = await post({ action: 'edit', id: 'q1', answerText: 'x' });
    expect(res.status).toBe(404);
    expect(editMock).not.toHaveBeenCalled();
  });
});

describe('admin questions mutation route — actions (admin)', () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({ userId: 'admin-1' });
    isAdminUserMock.mockReturnValue(true);
  });

  it('dispatches an edit with only the provided fields', async () => {
    const res = await post({ action: 'edit', id: 'q1', questionText: 'New?', visibility: 'private' });
    expect(res.status).toBe(200);
    expect(editMock).toHaveBeenCalledWith('q1', expect.objectContaining({ questionText: 'New?', visibility: 'private' }));
  });

  it('rejects an edit with no editable fields', async () => {
    const res = await post({ action: 'edit', id: 'q1' });
    expect(res.status).toBe(400);
    expect(editMock).not.toHaveBeenCalled();
  });

  it('soft-deletes', async () => {
    const res = await post({ action: 'delete', id: 'q1' });
    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledWith('q1');
  });

  it('restores', async () => {
    const res = await post({ action: 'restore', id: 'q1' });
    expect(res.status).toBe(200);
    expect(restoreMock).toHaveBeenCalledWith('q1');
  });

  it('404s when a mutation reports not_found', async () => {
    deleteMock.mockResolvedValue({ ok: false, reason: 'not_found' });
    const res = await post({ action: 'delete', id: 'missing' });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid visibility value', async () => {
    const res = await post({ action: 'edit', id: 'q1', visibility: 'blocked' });
    expect(res.status).toBe(400);
    expect(editMock).not.toHaveBeenCalled();
  });
});
