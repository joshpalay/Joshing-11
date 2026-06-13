import { beforeEach, describe, expect, it, vi } from 'vitest';

// The home-only "Shared Ground" carousel promo: one slide per friend the viewer
// shares latent common ground with. We mock the two queries it reads so we can
// assert the per-friend shape (and the dedupe guard) without a DB.
const { getFriendsMock, getCommonGroundMock } = vi.hoisted(() => ({
  getFriendsMock: vi.fn(),
  getCommonGroundMock: vi.fn(),
}));

vi.mock('@/server/db/queries/friends', () => ({
  getFriends: getFriendsMock,
}));

vi.mock('@/server/db/queries/common-ground', () => ({
  getCommonGround: getCommonGroundMock,
}));

import { getCommonGroundPromo } from '@/server/activity/common-ground-promo';
import type { StreamEmbed } from '@/lib/activity-stream';

const NOW = new Date('2026-06-08T12:00:00Z');

function friend(id: string, displayName: string) {
  // The promo only reads id + displayName off the User row.
  return { id, displayName } as never;
}

function latentDomain(label: string, points = 100) {
  return {
    canonical_subcategory: label,
    broad_category: null,
    viewer: { mastery_points: points, current_tier: 'curious' as const, proven: false },
    friend: { mastery_points: points, current_tier: 'curious' as const, proven: true },
    kind: 'latent' as const,
  };
}

function ground(...labels: string[]) {
  return {
    proven: [],
    latent: labels.map((l) => latentDomain(l)),
    isEmpty: labels.length === 0,
  };
}

function commonGroundEmbed(item: NonNullable<Awaited<ReturnType<typeof getCommonGroundPromo>>>) {
  return item.embed as Extract<StreamEmbed, { kind: 'common_ground' }>;
}

describe('getCommonGroundPromo', () => {
  beforeEach(() => {
    getFriendsMock.mockReset();
    getCommonGroundMock.mockReset();
  });

  it('returns null when the viewer has no friends', async () => {
    getFriendsMock.mockResolvedValue([]);
    expect(await getCommonGroundPromo('user-1', NOW)).toBeNull();
    expect(getCommonGroundMock).not.toHaveBeenCalled();
  });

  it('returns null when no friend has latent common ground', async () => {
    getFriendsMock.mockResolvedValue([friend('f1', 'Robyn')]);
    getCommonGroundMock.mockResolvedValue(ground());
    expect(await getCommonGroundPromo('user-1', NOW)).toBeNull();
  });

  it('builds one carousel slide per distinct friend', async () => {
    getFriendsMock.mockResolvedValue([friend('f1', 'Robyn Lee'), friend('f2', 'Sam')]);
    getCommonGroundMock.mockImplementation((_viewer: string, friendId: string) =>
      Promise.resolve(friendId === 'f1' ? ground('Star Wars') : ground('Jazz')),
    );

    const item = await getCommonGroundPromo('user-1', NOW);
    const embed = commonGroundEmbed(item!);
    // Order rotates by day seed, so compare as a set; the point is one slide each.
    expect([...embed.friends].map((f) => f.friendId).sort()).toEqual(['f1', 'f2']);
    expect(new Map(embed.friends.map((f) => [f.friendId, f.friendFirstName]))).toEqual(
      new Map([
        ['f1', 'Robyn'],
        ['f2', 'Sam'],
      ]),
    );
  });

  it('never places the same friend on two carousel slides (duplicate follow edges)', async () => {
    // getMutualFollows can return the same person twice when there are duplicate
    // approved follow edges. The carousel tours PEOPLE, so the dedupe guard must
    // collapse the repeat instead of surfacing it as a second station.
    getFriendsMock.mockResolvedValue([
      friend('f1', 'Testing'),
      friend('f1', 'Testing'),
      friend('f2', 'Robyn'),
    ]);
    getCommonGroundMock.mockImplementation((_viewer: string, friendId: string) =>
      Promise.resolve(friendId === 'f1' ? ground('Star Wars') : ground('Jazz')),
    );

    const item = await getCommonGroundPromo('user-1', NOW);
    const embed = commonGroundEmbed(item!);
    // f1 appears once, not twice — distinct people, one slide each.
    expect([...embed.friends].map((f) => f.friendId).sort()).toEqual(['f1', 'f2']);
    // The duplicate friend is probed once, not twice.
    expect(getCommonGroundMock).toHaveBeenCalledWith('user-1', 'f1');
    expect(getCommonGroundMock.mock.calls.filter((c) => c[1] === 'f1')).toHaveLength(1);
  });
});
