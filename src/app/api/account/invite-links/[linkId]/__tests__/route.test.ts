import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, updateInviteLinkMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  updateInviteLinkMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/invite-links', () => ({
  updateInviteLink: updateInviteLinkMock,
}));

import { PATCH } from '@/app/api/account/invite-links/[linkId]/route';

function request(categories: unknown, title: unknown = 'Your greatest hits') {
  return new Request('https://example.com/api/account/invite-links/link-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, categories }),
  });
}

const context = { params: Promise.resolve({ linkId: 'link-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/account/invite-links/[linkId]', () => {
  it('requires at least one valid category during edit', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });

    const response = await PATCH(request(['No category']), context);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_categories');
    expect(updateInviteLinkMock).not.toHaveBeenCalled();
  });

  it('updates the requested link title while preserving its validated category set', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    updateInviteLinkMock.mockResolvedValueOnce({
      ok: true,
      title: 'Late-night jazz',
      categories: [{ label: 'Jazz', broadCategory: 'Music', description: null }],
    });

    const response = await PATCH(
      request([{ label: 'Jazz', broadCategory: 'Music' }], 'Late-night jazz'),
      context,
    );

    expect(response.status).toBe(200);
    expect(updateInviteLinkMock).toHaveBeenCalledWith('u1', 'link-1', 'Late-night jazz', [
      { label: 'Jazz', broadCategory: 'Music' },
    ]);
    expect(await response.json()).toEqual({
      title: 'Late-night jazz',
      categories: [{ label: 'Jazz', broadCategory: 'Music', description: null }],
    });
  });

  it('requires a nonblank title during edit', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });

    const response = await PATCH(request([{ label: 'Jazz' }], '   '), context);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_title');
    expect(updateInviteLinkMock).not.toHaveBeenCalled();
  });
});
