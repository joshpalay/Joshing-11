import { beforeEach, describe, expect, it, vi } from 'vitest';

// The home-only add-friends promo: gated ~1 in 5 first, then either suggestions
// (addable contact matches) or an invite nudge — never both. We mock the one
// query it reads so we can assert the gate, the filter, the cap, and the variant
// selection without a DB.
const { listContactMatchesMock } = vi.hoisted(() => ({
  listContactMatchesMock: vi.fn(),
}));

vi.mock('@/server/db/queries/contact-hashes', () => ({
  listContactMatches: listContactMatchesMock,
}));

import { getAddFriendsPromo } from '@/server/activity/add-friends-promo';
import type { RelationshipState } from '@/server/db/queries/friend-requests';

function match(id: string, state: RelationshipState, displayName = id, handle: string | null = id) {
  return {
    id,
    handle,
    displayName,
    avatarColor: null,
    createdAt: new Date(),
    relationship: { state, friendshipId: null, formedAt: null, isBlocked: false },
  };
}

const NOW = new Date('2026-06-08T12:00:00Z');

describe('getAddFriendsPromo', () => {
  beforeEach(() => {
    listContactMatchesMock.mockReset();
  });

  it('returns null without reading contacts when the visit is gated out', async () => {
    const item = await getAddFriendsPromo('user-1', NOW, () => 0.9);
    expect(item).toBeNull();
    expect(listContactMatchesMock).not.toHaveBeenCalled();
  });

  it('suggests up to three addable matches when shown', async () => {
    listContactMatchesMock.mockResolvedValue([
      match('a', 'none'),
      match('b', 'follows_you'),
      match('c', 'following'), // already following — not addable
      match('d', 'none'),
      match('e', 'none'),
    ]);

    const item = await getAddFriendsPromo('user-1', NOW, () => 0.1);
    expect(item).not.toBeNull();
    const embed = item!.embed as Extract<NonNullable<typeof item.embed>, { kind: 'add_friends' }>;
    expect(embed.kind).toBe('add_friends');
    expect(embed.variant).toBe('suggestions');
    if (embed.variant !== 'suggestions') throw new Error('expected suggestions variant');
    expect(embed.people.map((p) => p.id)).toEqual(['a', 'b', 'd']);
    expect(embed.href).toBe('/friends/find');
  });

  it('falls back to the invite nudge when shown but no match is addable', async () => {
    listContactMatchesMock.mockResolvedValue([match('c', 'following'), match('f', 'friends')]);
    const item = await getAddFriendsPromo('user-1', NOW, () => 0.0);
    expect(item).not.toBeNull();
    const embed = item!.embed as Extract<NonNullable<typeof item.embed>, { kind: 'add_friends' }>;
    expect(embed.variant).toBe('invite');
  });
});
