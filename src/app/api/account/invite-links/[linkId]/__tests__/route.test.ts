import { describe, expect, it, vi } from 'vitest';

const { getSessionMock, updateInviteLinkCategoriesMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  updateInviteLinkCategoriesMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/invite-links', () => ({
  updateInviteLinkCategories: updateInviteLinkCategoriesMock,
}));

import { PATCH } from '@/app/api/account/invite-links/[linkId]/route';

function request(categories: unknown) {
  return new Request('https://example.com/api/account/invite-links/link-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ categories }),
  });
}

const context = { params: Promise.resolve({ linkId: 'link-1' }) };

describe('PATCH /api/account/invite-links/[linkId]', () => {
  it('requires at least one valid category during edit', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });

    const response = await PATCH(request(['No category']), context);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_categories');
    expect(updateInviteLinkCategoriesMock).not.toHaveBeenCalled();
  });

  it('updates only the requested link with the validated category set', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    updateInviteLinkCategoriesMock.mockResolvedValueOnce({
      ok: true,
      categories: [{ label: 'Jazz', broadCategory: 'Music', description: null }],
    });

    const response = await PATCH(request([{ label: 'Jazz', broadCategory: 'Music' }]), context);

    expect(response.status).toBe(200);
    expect(updateInviteLinkCategoriesMock).toHaveBeenCalledWith('u1', 'link-1', [
      { label: 'Jazz', broadCategory: 'Music' },
    ]);
  });
});
