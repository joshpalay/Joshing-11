import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextRequest } from 'next/server';

// B-ADMIN-QUESTIONS-OVERVIEW-01 Phase 4 — mutation route tests. The gate is
// re-checked on the SERVER for every mutation (never trust the client); non-admins
// (and the unauthenticated) get 404, not 403 — the route's existence is hidden.

const { getSessionMock, isAdminUserMock, editMock, deleteMock, restoreMock, reattributeMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<() => Promise<{ userId: string } | null>>(),
  isAdminUserMock: vi.fn<(userId: string | null | undefined) => boolean>(),
  editMock: vi.fn(async () => ({ ok: true })),
  deleteMock: vi.fn(async () => ({ ok: true })),
  restoreMock: vi.fn(async () => ({ ok: true })),
  reattributeMock: vi.fn(async () => ({ ok: true, updated: 0, skipped: 0 })),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/auth/admin', () => ({ isAdminUser: isAdminUserMock }));
vi.mock('@/server/db/queries/admin-questions', () => ({
  adminEditQuestion: editMock,
  adminSoftDeleteQuestion: deleteMock,
  adminRestoreQuestion: restoreMock,
  adminBulkReattributeToHouse: reattributeMock,
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
  reattributeMock.mockResolvedValue({ ok: true, updated: 0, skipped: 0 });
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

  it('dispatches an inside-joke edit (including clearing it to empty)', async () => {
    const set = await post({ action: 'edit', id: 'q1', insideJoke: 'between us' });
    expect(set.status).toBe(200);
    expect(editMock).toHaveBeenCalledWith('q1', expect.objectContaining({ insideJoke: 'between us' }));

    editMock.mockClear();
    const clear = await post({ action: 'edit', id: 'q1', insideJoke: '' });
    expect(clear.status).toBe(200);
    expect(editMock).toHaveBeenCalledWith('q1', expect.objectContaining({ insideJoke: '' }));
  });

  it('rejects an edit with no editable fields', async () => {
    const res = await post({ action: 'edit', id: 'q1' });
    expect(res.status).toBe(400);
    expect(editMock).not.toHaveBeenCalled();
  });

  it('dispatches a re-attribution to house', async () => {
    const res = await post({ action: 'edit', id: 'q1', attribution: 'house' });
    expect(res.status).toBe(200);
    expect(editMock).toHaveBeenCalledWith('q1', expect.objectContaining({ attribution: 'house' }));
  });

  it('rejects an unsupported attribution target', async () => {
    const res = await post({ action: 'edit', id: 'q1', attribution: 'person' });
    expect(res.status).toBe(400);
    expect(editMock).not.toHaveBeenCalled();
  });

  it('dispatches a bulk re-attribution to house and reports counts', async () => {
    reattributeMock.mockResolvedValue({ ok: true, updated: 2, skipped: 1 });
    const res = await post({ action: 'reattribute_house', ids: ['q1', 'q2', 'q3'] });
    expect(res.status).toBe(200);
    expect(reattributeMock).toHaveBeenCalledWith(['q1', 'q2', 'q3']);
    expect(await res.json()).toEqual({ ok: true, updated: 2, skipped: 1 });
  });

  it('rejects a bulk re-attribution with an empty ids list', async () => {
    const res = await post({ action: 'reattribute_house', ids: [] });
    expect(res.status).toBe(400);
    expect(reattributeMock).not.toHaveBeenCalled();
  });

  it('rejects a bulk re-attribution above the per-request cap', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `q${i}`);
    const res = await post({ action: 'reattribute_house', ids });
    expect(res.status).toBe(400);
    expect(reattributeMock).not.toHaveBeenCalled();
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
