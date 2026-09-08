import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getFriendInvitationLandingByTokenMock, getSessionMock, redirectMock } = vi.hoisted(() => ({
  getFriendInvitationLandingByTokenMock: vi.fn(),
  getSessionMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/server/friends/invitations', () => ({
  getFriendInvitationLandingByToken: getFriendInvitationLandingByTokenMock,
}));
vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import InvitePage from '@/app/invite/[token]/page';

async function renderInvite(token = 'safe-token') {
  const element = await InvitePage({ params: Promise.resolve({ token }) });
  return renderToStaticMarkup(element);
}

describe('/invite/[token] landing QA states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue(null);
  });

  it('shows personalized context before a signed-out recipient continues to authentication', async () => {
    getFriendInvitationLandingByTokenMock.mockResolvedValueOnce({
      status: 'valid',
      inviterName: 'Alex',
      inviterUserId: 'u1',
      inviterAvatarColor: null,
      categories: ['Jazz', 'Poetry'],
    });

    const html = await renderInvite('valid-token');

    expect(html).toContain('Alex invited you to Joshing');
    expect(html).toContain('Play Alex’s greatest hits');
    expect(html).toContain('Alex picked a few categories');
    expect(html).toContain('Jazz');
    expect(html).toContain('Poetry');
    expect(html).toContain('Continue with Alex');
    expect(html).toContain('href="/login?invitationToken=valid-token"');
    expect(getFriendInvitationLandingByTokenMock).toHaveBeenCalledWith('valid-token');
  });

  it('lets a signed-in recipient continue without a login link', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'recipient-1' });
    getFriendInvitationLandingByTokenMock.mockResolvedValueOnce({
      status: 'valid',
      inviterName: 'Alex',
      inviterUserId: 'u1',
      inviterAvatarColor: null,
      categories: ['Jazz'],
    });

    const html = await renderInvite('valid-token');

    expect(html).toContain('Continue with Alex');
    expect(html).not.toContain('href="/login?invitationToken=valid-token"');
  });

  it.each([
    {
      status: 'expired',
      expectedHeading: 'This invitation has expired.',
      expectedEyebrow: 'Invitation expired',
    },
    {
      status: 'accepted',
      expectedHeading: 'This invitation has already been used.',
      expectedEyebrow: 'Invitation already used',
    },
    {
      status: 'invalid',
      expectedHeading: 'This invitation link is not valid.',
      expectedEyebrow: 'Invitation unavailable',
    },
  ])(
    'renders the $status invite state safely',
    async ({ status, expectedHeading, expectedEyebrow }) => {
      getFriendInvitationLandingByTokenMock.mockResolvedValueOnce({
        status,
        inviterName: 'Secret Inviter',
        inviterUserId: null,
        inviterAvatarColor: null,
        categories: ['Secret Category'],
      });

      const html = await renderInvite(`${status}-token`);

      expect(html).toContain(expectedEyebrow);
      expect(html).toContain(expectedHeading);
      expect(html).toContain('href="/login"');
      expect(html).not.toContain(`${status}-token`);
      expect(html).not.toContain('Secret Inviter');
      expect(html).not.toContain('Secret Category');
    },
  );

  it('uses neutral fallback copy when the inviter has no safe public name', async () => {
    getFriendInvitationLandingByTokenMock.mockResolvedValueOnce({
      status: 'valid',
      inviterName: '+1 (734) 555-0123',
      inviterUserId: 'u1',
      inviterAvatarColor: null,
      categories: ['Jazz'],
    });

    const html = await renderInvite('valid-token');

    expect(html).toContain('You’ve been invited to Joshing');
    expect(html).toContain('Play the greatest hits');
    expect(html).toContain('Someone picked a few categories to get you started.');
    expect(html).not.toContain('734');
  });
});
