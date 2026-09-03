import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchParamsMock } = vi.hoisted(() => ({
  searchParamsMock: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParamsMock,
}));

import LoginPanel from '@/app/login/LoginPanel';

function expectOneOtpDisclosure(html: string) {
  expect(
    html.match(
      /By selecting Continue, you agree to receive one automated Joshing verification text/g,
    ),
  ).toHaveLength(1);
  expect(html).toContain('Message and data rates may apply');
  expect(html).toContain('Reply <strong>STOP</strong> to unsubscribe');
  expect(html).toContain('<strong>HELP</strong> for help');
  expect(html).toContain('Consent is not a condition of purchase');
  expect(html).toContain('href="/terms"');
  expect(html).toContain('href="/privacy"');
}

describe('LoginPanel OTP request disclosure', () => {
  beforeEach(() => {
    searchParamsMock.delete('invitationToken');
  });

  it('places the disclosure beside the manual phone-entry action', () => {
    const html = renderToStaticMarkup(<LoginPanel />);
    expect(html).toContain('What is your phone number?');
    expectOneOtpDisclosure(html);
  });

  it('places the disclosure beside the invitation-prefilled Send text action', () => {
    searchParamsMock.set('invitationToken', 'invite-token');
    const html = renderToStaticMarkup(
      <LoginPanel
        invitePrefill={{
          inviterName: 'Alex',
          inviterUserId: 'inviter-1',
          inviterAvatarColor: null,
          inviteePhone: '+17345550123',
        }}
      />,
    );
    expect(html).toContain('Send text');
    expectOneOtpDisclosure(html);
  });
});

// Stage 2 (invite-link seed topics): the per-user invite-link card shows up
// to 3 topics; the named FriendInvitation path never carries them.
describe('LoginPanel invite context topics', () => {
  beforeEach(() => {
    searchParamsMock.delete('invitationToken');
  });

  it('renders topics on the per-user invite-link card', () => {
    const html = renderToStaticMarkup(
      <LoginPanel
        inviteContext={{
          inviterName: 'Jaime',
          inviterUserId: 'inviter-1',
          inviterAvatarColor: null,
          topics: ['Jazz', 'Poetry'],
        }}
      />,
    );

    expect(html).toContain('Jaime invited you to Joshing');
    expect(html).toContain('Jazz');
    expect(html).toContain('Poetry');
  });

  it('renders no topic chips for the named-invitation path (topics absent)', () => {
    const html = renderToStaticMarkup(
      <LoginPanel
        inviteContext={{
          inviterName: 'Alex',
          inviterUserId: 'inviter-2',
          inviterAvatarColor: null,
        }}
      />,
    );

    expect(html).toContain('Alex invited you to Joshing');
    // No chip markup at all — the wrapping div is conditional on topics.length.
    expect(html).not.toContain('rounded-full border border-[var(--accent-gold)]/40 bg-white/70');
  });

  it('renders no topic chips when topics resolved to an empty array', () => {
    const html = renderToStaticMarkup(
      <LoginPanel
        inviteContext={{
          inviterName: 'Robyn',
          inviterUserId: 'inviter-3',
          inviterAvatarColor: null,
          topics: [],
        }}
      />,
    );

    expect(html).toContain('Robyn invited you to Joshing');
    expect(html).not.toContain('rounded-full border border-[var(--accent-gold)]/40 bg-white/70');
  });
});
