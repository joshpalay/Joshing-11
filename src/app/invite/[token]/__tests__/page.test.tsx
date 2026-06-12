import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getFriendInvitationLandingByTokenMock } = vi.hoisted(() => ({
  getFriendInvitationLandingByTokenMock: vi.fn(),
}));

vi.mock('@/server/friends/invitations', () => ({
  getFriendInvitationLandingByToken: getFriendInvitationLandingByTokenMock,
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

  it('opens a valid invite landing with inviter name and auth continuation, but does NOT leak pre-seeded interests (F1.5)', async () => {
    getFriendInvitationLandingByTokenMock.mockResolvedValueOnce({
      status: 'valid',
      inviterName: 'Alex Inviter',
    });

    const html = await renderInvite('valid-token');

    expect(getFriendInvitationLandingByTokenMock).toHaveBeenCalledWith('valid-token');
    expect(html).toContain('A friend thought of you');
    expect(html).toContain('Alex Inviter thought of you for Joshing.');
    expect(html).toContain('Continue to Joshing');
    expect(html).not.toContain('A note from a friend');
    expect(html).not.toContain('See the note');
    expect(html).toContain('href="/login?invitationToken=valid-token"');
    expect(html).not.toContain('href="/login"');
    expect(html).not.toMatch(/leaderboard|ranking|score|points?|percent|%/i);
  });

  it('never renders pre-seeded interest labels even if a stale payload includes them (defensive)', async () => {
    // Defends against a regression where the type is reverted: even if the
    // landing query somehow ships labels, the page must not render them.
    getFriendInvitationLandingByTokenMock.mockResolvedValueOnce({
      status: 'valid',
      inviterName: 'Alex Inviter',
      // @ts-expect-error - field is intentionally not on the type
      suggestedInterests: [{ label: 'Jazz' }, { label: 'Poetry' }],
    });

    const html = await renderInvite('valid-token');
    expect(html).not.toContain('Jazz');
    expect(html).not.toContain('Poetry');
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
