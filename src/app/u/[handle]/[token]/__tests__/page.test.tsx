import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveInviteLinkMock, getSessionMock, redirectMock } = vi.hoisted(() => ({
  resolveInviteLinkMock: vi.fn(),
  getSessionMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/server/friends/user-invite-token', () => ({ resolveInviteLink: resolveInviteLinkMock }));
vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import UserInvitePage from '@/app/u/[handle]/[token]/page';

function resolution(overrides: Record<string, unknown> = {}) {
  return {
    inviterUserId: 'inviter-1',
    inviterHandle: 'josh',
    inviterDisplayName: 'Josh',
    inviterAvatarColor: null,
    linkId: 'link-1',
    slot: 0,
    seedTopics: ['Sondheim', 'Jazz'],
    ...overrides,
  };
}

async function render(handle = 'josh', token = 'safe-token') {
  const element = await UserInvitePage({ params: Promise.resolve({ handle, token }) });
  return renderToStaticMarkup(element);
}

describe('/u/[handle]/[token] personalized invitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ userId: 'recipient-1' });
  });

  it('uses the inviter identity and exact categories resolved from the server record', async () => {
    resolveInviteLinkMock.mockResolvedValueOnce(
      resolution({ inviterDisplayName: 'Duo Prova' }),
    );

    const html = await render();

    expect(resolveInviteLinkMock).toHaveBeenCalledWith('josh', 'safe-token');
    expect(html).toContain('Duo Prova invited you to Joshing');
    expect(html).toContain('Play Duo Prova’s greatest hits');
    expect(html).toContain('Sondheim');
    expect(html).toContain('Jazz');
    expect(html).toContain('Accept Duo Prova’s invitation');
  });

  it('takes a signed-out recipient directly to the invite-aware phone screen', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    resolveInviteLinkMock.mockResolvedValueOnce(resolution());

    await expect(render()).rejects.toThrow(
      'NEXT_REDIRECT:/login?inviteHandle=josh&inviteUserToken=safe-token',
    );
  });

  it('cannot spoof the inviter name through URL query data', async () => {
    resolveInviteLinkMock.mockResolvedValueOnce(resolution({ inviterDisplayName: 'Josh' }));

    const element = await UserInvitePage({
      params: Promise.resolve({ handle: 'josh', token: 'safe-token' }),
      searchParams: Promise.resolve({ inviterName: 'Mallory' }),
    } as never);
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Josh invited you to Joshing');
    expect(html).not.toContain('Mallory');
  });

  it('keeps category sets isolated between two links', async () => {
    resolveInviteLinkMock
      .mockResolvedValueOnce(resolution({ linkId: 'a', seedTopics: ['Jazz'] }))
      .mockResolvedValueOnce(resolution({ linkId: 'b', seedTopics: ['Poetry'] }));

    const first = await render('josh', 'token-a');
    const second = await render('josh', 'token-b');

    expect(first).toContain('Jazz');
    expect(first).not.toContain('Poetry');
    expect(second).toContain('Poetry');
    expect(second).not.toContain('Jazz');
  });

  it('shows personalized context to a signed-in recipient without a login link', async () => {
    resolveInviteLinkMock.mockResolvedValueOnce(resolution());

    const html = await render();

    expect(html).toContain('Josh invited you to Joshing');
    expect(html).toContain('Accept Josh’s invitation');
    expect(html).not.toContain('inviteHandle=');
  });

  it('reveals no inviter or categories for an invalid link', async () => {
    resolveInviteLinkMock.mockResolvedValueOnce(null);

    const html = await render('josh', 'bad-token');

    expect(html).toContain('This invitation link is no longer valid.');
    expect(html).not.toContain('Josh invited');
    expect(html).not.toContain('Sondheim');
    expect(html).not.toContain('bad-token');
  });

  it('uses neutral copy when the inviter has no safe public name', async () => {
    resolveInviteLinkMock.mockResolvedValueOnce(resolution({ inviterDisplayName: null }));

    const html = await render();

    expect(html).toContain('You’ve been invited to Joshing');
    expect(html).toContain('Play the greatest hits');
    expect(html).toContain('Someone picked a few categories to get you started.');
    expect(html).toContain('>Accept invitation<');
    expect(html).not.toContain('undefined');
  });
});
