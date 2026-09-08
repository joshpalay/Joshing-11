import { describe, expect, it, vi } from 'vitest';

const { getSessionMock, acceptUserInviteLinkMock, dbSelectMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  acceptUserInviteLinkMock: vi.fn(),
  dbSelectMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/friends/user-invite-token', () => ({
  acceptUserInviteLink: acceptUserInviteLinkMock,
}));
vi.mock('@/server/db', () => ({
  db: { select: dbSelectMock },
  users: { id: 'id', onboardingComplete: 'onboardingComplete' },
}));

import { POST } from '@/app/api/invite-links/accept/route';

function request(body: unknown) {
  return new Request('https://example.com/api/invite-links/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockUser(onboardingComplete: boolean) {
  dbSelectMock.mockReturnValue({
    from: () => ({ where: () => ({ limit: async () => [{ onboardingComplete }] }) }),
  });
}

describe('POST /api/invite-links/accept', () => {
  it('accepts for the signed-in user and sends unfinished accounts to onboarding', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'recipient-1' });
    mockUser(false);
    acceptUserInviteLinkMock.mockResolvedValueOnce({ accepted: true });

    const response = await POST(request({ handle: 'josh', token: 'token-1' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ nextHref: '/onboarding' });
    expect(acceptUserInviteLinkMock).toHaveBeenCalledWith({
      handle: 'josh',
      token: 'token-1',
      inviteeUserId: 'recipient-1',
    });
  });

  it('does not require authentication again for an onboarded returning user', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'recipient-1' });
    mockUser(true);
    acceptUserInviteLinkMock.mockResolvedValueOnce({ accepted: true });

    const response = await POST(request({ handle: 'josh', token: 'token-1' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ nextHref: '/' });
  });
});
