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

describe('LoginPanel invite context', () => {
  beforeEach(() => {
    searchParamsMock.delete('invitationToken');
  });

  it('highlights the inviter name without rendering category chips', () => {
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

    expect(html).toContain(
      '<strong class="font-semibold text-[var(--brand-navy)]">Jaime</strong> invited you to Joshing',
    );
    expect(html).not.toContain('Jazz');
    expect(html).not.toContain('Poetry');
  });

  it('renders the named-invitation path without topic chips', () => {
    const html = renderToStaticMarkup(
      <LoginPanel
        inviteContext={{
          inviterName: 'Alex',
          inviterUserId: 'inviter-2',
          inviterAvatarColor: null,
        }}
      />,
    );

    expect(html).toContain('>Alex</strong> invited you to Joshing');
    expect(html).not.toContain('rounded-full border border-[var(--accent-gold)]/40 bg-white/70');
  });
});
