import { describe, expect, it, vi } from 'vitest';

const { getSessionMock, acceptFriendInvitationMock, dbSelectMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  acceptFriendInvitationMock: vi.fn(),
  dbSelectMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/friends/invitations', () => ({
  acceptFriendInvitation: acceptFriendInvitationMock,
}));
vi.mock('@/server/db', () => ({
  db: { select: dbSelectMock },
  users: {
    id: 'id',
    phoneNumber: 'phoneNumber',
    phoneVerified: 'phoneVerified',
    onboardingComplete: 'onboardingComplete',
  },
}));

import { POST } from '@/app/api/friend-invitations/accept-token/route';

function request(token = 'token-1') {
  return new Request('https://example.com/api/friend-invitations/accept-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

function mockUser(onboardingComplete: boolean) {
  dbSelectMock.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => [
          { phoneNumber: '+17345550123', phoneVerified: true, onboardingComplete },
        ],
      }),
    }),
  });
}

describe('POST /api/friend-invitations/accept-token', () => {
  it('uses the authenticated user’s verified phone without sending them through login again', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'recipient-1' });
    mockUser(false);
    acceptFriendInvitationMock.mockResolvedValueOnce({ accepted: true });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ nextHref: '/onboarding' });
    expect(acceptFriendInvitationMock).toHaveBeenCalledWith({
      token: 'token-1',
      inviteeUserId: 'recipient-1',
      verifiedPhone: '+17345550123',
    });
  });
});
