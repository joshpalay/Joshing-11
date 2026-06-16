import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getFriendInvitationLandingByTokenMock, redirectMock } = vi.hoisted(() => ({
  getFriendInvitationLandingByTokenMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    // Mirror Next's real redirect(): throw to halt rendering.
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/server/friends/invitations', () => ({
  getFriendInvitationLandingByToken: getFriendInvitationLandingByTokenMock,
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import InvitePage from '@/app/invite/[token]/page';

async function renderInvite(token = 'safe-token') {
  const element = await InvitePage({ params: Promise.resolve({ token }) });
  return renderToStaticMarkup(element);
}

describe('/invite/[token] landing QA states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a valid invite straight to the login screen with the invite context attached (no interstitial)', async () => {
    getFriendInvitationLandingByTokenMock.mockResolvedValueOnce({
      status: 'valid',
      inviterName: 'Alex Inviter',
    });

    await expect(renderInvite('valid-token')).rejects.toThrow(
      'NEXT_REDIRECT:/login?invitationToken=valid-token',
    );

    expect(getFriendInvitationLandingByTokenMock).toHaveBeenCalledWith('valid-token');
    expect(redirectMock).toHaveBeenCalledWith('/login?invitationToken=valid-token');
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
      expectedEyebrow: 'Invalid invitation',
    },
  ])(
    'renders the $status invite state safely',
    async ({ status, expectedHeading, expectedEyebrow }) => {
      getFriendInvitationLandingByTokenMock.mockResolvedValueOnce({
        status,
        inviterName: 'Alex Inviter',
      });

      const html = await renderInvite(`${status}-token`);

      expect(html).toContain(expectedEyebrow);
      expect(html).toContain(expectedHeading);
      expect(html).toContain('href="/login"');
      expect(html).not.toContain(`${status}-token`);
    },
  );
});
