import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCurrentUserMock,
  playerMasteryFindManyMock,
  playerMasteryFindFirstMock,
  masteryEventFindManyMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  playerMasteryFindManyMock: vi.fn(),
  playerMasteryFindFirstMock: vi.fn(),
  masteryEventFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/user', () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerMastery: {
      findMany: playerMasteryFindManyMock,
      findFirst: playerMasteryFindFirstMock,
    },
    masteryEvent: {
      findMany: masteryEventFindManyMock,
    },
  },
}));

import { GET } from '@/app/api/users/[userId]/mastery/ceremony/route';

describe('/api/users/[userId]/mastery/ceremony', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ceremony mastery queries from mastery tables', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 'u-1' });
    playerMasteryFindManyMock
      .mockResolvedValueOnce([
        { canonical_subcategory: 'Biology', total_points: 8.5, tier: 'solid', updated_at: new Date('2026-04-08T00:00:00.000Z') },
        { canonical_subcategory: 'History', total_points: 3, tier: 'familiar', updated_at: new Date('2026-04-09T00:00:00.000Z') },
      ])
      .mockResolvedValueOnce([
        { canonical_subcategory: 'Biology', total_points: 8.5, tier: 'solid', updated_at: new Date('2026-04-08T00:00:00.000Z') },
        { canonical_subcategory: 'History', total_points: 3, tier: 'familiar', updated_at: new Date('2026-04-09T00:00:00.000Z') },
      ])
      .mockResolvedValueOnce([
        { canonical_subcategory: 'Biology', total_points: 8.5, tier: 'solid' },
      ]);
    playerMasteryFindFirstMock.mockResolvedValue({
      canonical_subcategory: 'Biology',
      total_points: 8.5,
      tier: 'solid',
      updated_at: new Date('2026-04-08T00:00:00.000Z'),
    });
    masteryEventFindManyMock.mockResolvedValue([
      { canonical_subcategory: 'Biology', awarded_points: 1.5 },
    ]);

    const response = await GET(
      new Request('http://localhost/api/users/u-1/mastery/ceremony?topLimit=2&from=2026-04-01T00:00:00.000Z') as never,
      { params: Promise.resolve({ userId: 'u-1' }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user_id: 'u-1',
      top_categories: [
        { canonical_subcategory: 'Biology', total_points: 8.5 },
        { canonical_subcategory: 'History', total_points: 3 },
      ],
      category_totals: [
        { canonical_subcategory: 'Biology', total_points: 8.5 },
        { canonical_subcategory: 'History', total_points: 3 },
      ],
      mastery_movement: [
        {
          canonical_subcategory: 'Biology',
          points_before: 7,
          points_after: 8.5,
          points_delta: 1.5,
        },
      ],
      strongest_category: {
        canonical_subcategory: 'Biology',
        total_points: 8.5,
      },
    });
  });
});
