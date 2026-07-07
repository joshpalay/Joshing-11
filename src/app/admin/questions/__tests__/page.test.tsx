import { beforeEach, describe, expect, it, vi } from 'vitest';

// B-ADMIN-QUESTIONS-OVERVIEW-01 Phase 1 — gating test. Mirrors the admin-gate
// contract used across the admin rooms: a non-admin (or unauthenticated) session
// must 404 via notFound(), and the pool query must never run for them. Admins get
// the query and a rendered client.

const { getSessionMock, isAdminUserMock, getAllQuestionsMock, notFoundMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<() => Promise<{ userId: string } | null>>(),
  isAdminUserMock: vi.fn<(userId: string | null | undefined) => boolean>(),
  getAllQuestionsMock: vi.fn(async () => ({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 50,
    showDeleted: false,
  })),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({ notFound: notFoundMock }));
vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/auth/admin', () => ({ isAdminUser: isAdminUserMock }));
vi.mock('@/server/db/queries/admin-questions', () => ({ getAllQuestionsForAdmin: getAllQuestionsMock }));
vi.mock('../AdminQuestionsClient', () => ({
  AdminQuestionsClient: () => null,
}));

import AdminQuestionsPage from '@/app/admin/questions/page';

const searchParams = Promise.resolve({});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminQuestionsPage gating', () => {
  it('404s for an unauthenticated session and never queries the pool', async () => {
    getSessionMock.mockResolvedValue(null);
    isAdminUserMock.mockReturnValue(false);

    await expect(AdminQuestionsPage({ searchParams })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalled();
    expect(getAllQuestionsMock).not.toHaveBeenCalled();
  });

  it('404s for an authenticated non-admin and never queries the pool', async () => {
    getSessionMock.mockResolvedValue({ userId: 'not-admin' });
    isAdminUserMock.mockReturnValue(false);

    await expect(AdminQuestionsPage({ searchParams })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalled();
    expect(getAllQuestionsMock).not.toHaveBeenCalled();
  });

  it('renders and queries the pool for an admin', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin-1' });
    isAdminUserMock.mockReturnValue(true);

    await AdminQuestionsPage({ searchParams });

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(getAllQuestionsMock).toHaveBeenCalledTimes(1);
  });
});
