import { beforeEach, describe, expect, it, vi } from 'vitest';

// Locks the /api/nav contract the Questions-tab admin link depends on: isAdmin is
// resolved server-side from the ADMIN_USER_IDS allowlist and returned as a plain
// boolean (the allowlist itself never crosses to the client).

const {
  getSessionMock,
  isAdminUserMock,
  profileMock,
  bellMock,
  friendReqMock,
  discoveryMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn<() => Promise<{ userId: string } | null>>(),
  isAdminUserMock: vi.fn<(userId: string | null | undefined) => boolean>(),
  profileMock: vi.fn(async () => ({ displayName: 'Josh' })),
  bellMock: vi.fn(async () => 0),
  friendReqMock: vi.fn(async () => 0),
  discoveryMock: vi.fn(async () => ({ hasNew: false, count: 0 })),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/auth/admin', () => ({ isAdminUser: isAdminUserMock }));
vi.mock('@/server/db/queries/users', () => ({ getUserOnboardingProfile: profileMock }));
vi.mock('@/server/db/queries/activity', () => ({ getBellBadgeCount: bellMock }));
vi.mock('@/server/db/queries/friends', () => ({ getIncomingFollowRequestCount: friendReqMock }));
vi.mock('@/server/db/queries/contact-hashes', () => ({ getNewDiscoveryStatus: discoveryMock }));

import { GET } from '@/app/api/nav/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/nav isAdmin', () => {
  it('401s when unauthenticated', async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns isAdmin: true for an admin', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin-1' });
    isAdminUserMock.mockReturnValue(true);
    const body = await (await GET()).json();
    expect(body.isAdmin).toBe(true);
    expect(isAdminUserMock).toHaveBeenCalledWith('admin-1');
  });

  it('returns isAdmin: false for a non-admin', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user-2' });
    isAdminUserMock.mockReturnValue(false);
    const body = await (await GET()).json();
    expect(body.isAdmin).toBe(false);
  });
});
