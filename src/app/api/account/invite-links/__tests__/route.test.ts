import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSessionMock,
  listLiveInviteLinksMock,
  createInviteLinkMock,
  dbSelectMock,
  getInviteLinkSeedTopicsMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  listLiveInviteLinksMock: vi.fn(),
  createInviteLinkMock: vi.fn(),
  dbSelectMock: vi.fn(),
  getInviteLinkSeedTopicsMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/invite-links', () => ({
  listLiveInviteLinks: listLiveInviteLinksMock,
  createInviteLink: createInviteLinkMock,
}));
vi.mock('@/server/friends/user-invite-token', () => ({
  buildInviteUrl: (baseUrl: string, handle: string, token: string) =>
    `${baseUrl}/u/${handle}/${token}`,
  getBaseUrl: () => 'https://example.com',
  getInviteLinkSeedTopics: getInviteLinkSeedTopicsMock,
}));
vi.mock('@/server/db', () => ({
  db: { select: dbSelectMock },
  users: { handle: 'handle', id: 'id' },
}));

import { GET, POST } from '@/app/api/account/invite-links/route';

beforeEach(() => {
  vi.clearAllMocks();
});

function mockHandleRow(handle: string | null) {
  dbSelectMock.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(handle ? [{ handle }] : []),
      }),
    }),
  });
}

function jsonRequest(body: unknown) {
  return new Request('https://example.com/api/account/invite-links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/account/invite-links', () => {
  it('returns 401 when signed out', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const response = await GET(new Request('https://example.com/api/account/invite-links'));
    expect(response.status).toBe(401);
  });

  it('returns handle_required when the caller has no handle', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    mockHandleRow(null);
    const response = await GET(new Request('https://example.com/api/account/invite-links'));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('handle_required');
  });

  it('lists live links with built share URLs', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    mockHandleRow('joshp');
    listLiveInviteLinksMock.mockResolvedValueOnce([
      {
        id: 'lk1',
        token: 'tok1',
        slot: 0,
        title: null,
        categories: [{ label: 'Jazz', broadCategory: 'Music' }],
        createdAt: new Date('2026-01-01T00:00:00Z'),
        joinedCount: 4,
      },
    ]);
    const response = await GET(new Request('https://example.com/api/account/invite-links'));
    const body = await response.json();
    expect(body.links).toEqual([
      {
        id: 'lk1',
        slot: 0,
        title: 'Your greatest hits',
        categories: [{ label: 'Jazz', broadCategory: 'Music' }],
        url: 'https://example.com/u/joshp/tok1',
        createdAt: '2026-01-01T00:00:00.000Z',
        joinedCount: 4,
      },
    ]);
  });
});

describe('POST /api/account/invite-links', () => {
  it('returns 401 when signed out', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const response = await POST(jsonRequest({ slot: 1 }));
    expect(response.status).toBe(401);
  });

  it('rejects an invalid body', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    mockHandleRow('joshp');
    const response = await POST(jsonRequest({ slot: 'not-a-number' }));
    expect(response.status).toBe(400);
  });

  it('surfaces limit_reached as 409', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    mockHandleRow('joshp');
    createInviteLinkMock.mockResolvedValueOnce({ ok: false, error: 'limit_reached' });
    const response = await POST(
      jsonRequest({ title: 'Your greatest hits', categories: [{ label: 'Sondheim' }] }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('limit_reached');
  });

  it('creates a link and returns its share URL', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    mockHandleRow('joshp');
    createInviteLinkMock.mockResolvedValueOnce({
      ok: true,
      link: {
        id: 'lk2',
        token: 'tok2',
        slot: 0,
        title: 'Your greatest hits',
        categories: [{ label: 'Sondheim' }],
        createdAt: new Date('2026-01-02T00:00:00Z'),
        joinedCount: 0,
      },
    });
    const response = await POST(
      jsonRequest({ title: 'Your greatest hits', categories: [{ label: 'Sondheim' }] }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.link).toEqual({
      id: 'lk2',
      slot: 0,
      title: 'Your greatest hits',
      categories: [{ label: 'Sondheim' }],
      url: 'https://example.com/u/joshp/tok2',
      createdAt: '2026-01-02T00:00:00.000Z',
      joinedCount: 0,
    });
    expect(createInviteLinkMock).toHaveBeenCalledWith('u1', 'Your greatest hits', [
      { label: 'Sondheim', broadCategory: null },
    ]);
  });

  it('creates a link with a custom title', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    mockHandleRow('joshp');
    createInviteLinkMock.mockResolvedValueOnce({
      ok: true,
      link: {
        id: 'lk-custom',
        token: 'tok-custom',
        slot: 0,
        title: 'Family challenge',
        categories: [{ label: 'Sondheim' }],
        createdAt: new Date('2026-01-03T00:00:00Z'),
        joinedCount: 0,
      },
    });

    const response = await POST(
      jsonRequest({ title: 'Family challenge', categories: [{ label: 'Sondheim' }] }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).link.title).toBe('Family challenge');
    expect(createInviteLinkMock).toHaveBeenCalledWith('u1', 'Family challenge', [
      { label: 'Sondheim', broadCategory: null },
    ]);
  });

  it('requires a nonblank title', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    mockHandleRow('joshp');

    const response = await POST(jsonRequest({ title: '   ', categories: [{ label: 'Sondheim' }] }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_title');
    expect(createInviteLinkMock).not.toHaveBeenCalled();
  });

  it('requires at least one valid category', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    mockHandleRow('joshp');

    const response = await POST(
      jsonRequest({ title: 'Your greatest hits', categories: ['No category'] }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_categories');
    expect(createInviteLinkMock).not.toHaveBeenCalled();
  });

  it('keeps two links with different category sets isolated', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    mockHandleRow('joshp');
    listLiveInviteLinksMock.mockResolvedValueOnce([
      {
        id: 'a',
        token: 'ta',
        slot: 0,
        title: 'Jazz friends',
        categories: [{ label: 'Jazz' }],
        createdAt: new Date(),
        joinedCount: 0,
      },
      {
        id: 'b',
        token: 'tb',
        slot: 0,
        title: 'Poetry friends',
        categories: [{ label: 'Poetry' }],
        createdAt: new Date(),
        joinedCount: 1,
      },
    ]);

    const response = await GET(new Request('https://example.com/api/account/invite-links'));
    const body = await response.json();

    expect(body.links[0].categories.map((item: { label: string }) => item.label)).toEqual(['Jazz']);
    expect(body.links[1].categories.map((item: { label: string }) => item.label)).toEqual([
      'Poetry',
    ]);
  });
});
