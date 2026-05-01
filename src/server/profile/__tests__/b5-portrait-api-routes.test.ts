import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCurrentUserMock,
  getPortraitDataMock,
  getFriendPortraitDataMock,
  getMasteryDataMock,
  getCachedMultitudesCopyMock,
  setCachedMultitudesCopyMock,
  buildMultitudesCacheKeyMock,
  generateMultitudesCopyMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  getPortraitDataMock: vi.fn(),
  getFriendPortraitDataMock: vi.fn(),
  getMasteryDataMock: vi.fn(),
  getCachedMultitudesCopyMock: vi.fn(),
  setCachedMultitudesCopyMock: vi.fn(),
  buildMultitudesCacheKeyMock: vi.fn(),
  generateMultitudesCopyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock('@/lib/auth/user', () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock('@/server/profile/portrait', () => ({
  getPortraitData: getPortraitDataMock,
  getMasteryData: getMasteryDataMock,
}));
vi.mock('@/server/profile/friend', () => ({ getFriendPortraitData: getFriendPortraitDataMock }));
vi.mock('@/server/profile/multitudes', () => ({
  getCachedMultitudesCopy: getCachedMultitudesCopyMock,
  setCachedMultitudesCopy: setCachedMultitudesCopyMock,
  buildMultitudesCacheKey: buildMultitudesCacheKeyMock,
  generateMultitudesCopy: generateMultitudesCopyMock,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

import { GET as getOwnPortrait } from '@/app/api/users/[userId]/portrait/route';
import { GET as getFriendPortrait } from '@/app/api/users/[userId]/portrait/friend/route';
import { GET as getMastery } from '@/app/api/users/[userId]/mastery/route';

import { POST as postMultitudes } from '@/app/api/users/[userId]/portrait/multitudes/route';

describe('B5 portrait + mastery API gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildMultitudesCacheKeyMock.mockReturnValue('cache-key');
    getCachedMultitudesCopyMock.mockReturnValue(null);
  });

  it('locks own portrait route behind auth and owner checks', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);

    const unauthorized = await getOwnPortrait(
      new Request('http://localhost/api/users/u-1/portrait') as never,
      { params: Promise.resolve({ userId: 'u-1' }) },
    );
    expect(unauthorized.status).toBe(401);

    getCurrentUserMock.mockResolvedValueOnce({ id: 'viewer-1' });

    const forbidden = await getOwnPortrait(
      new Request('http://localhost/api/users/u-1/portrait') as never,
      { params: Promise.resolve({ userId: 'u-1' }) },
    );
    expect(forbidden.status).toBe(403);
    expect(getPortraitDataMock).not.toHaveBeenCalled();
  });

  it('returns own portrait payload for sparse/developing/rich state data', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 'u-1' });
    getPortraitDataMock.mockResolvedValue({
      categories: [
        { canonical_subcategory: 'Late Tchaikovsky', broad_category: 'Music', declared_score: 8, proven_score: 6 },
        { canonical_subcategory: 'Bowie-era Glam Rock', broad_category: 'Music', declared_score: 6, proven_score: 5 },
        { canonical_subcategory: 'Constitutional compromises of 1787', broad_category: 'History', declared_score: 4, proven_score: 8 },
      ],
      max_declared_score: 8,
      max_proven_score: 8,
    });

    const response = await getOwnPortrait(
      new Request('http://localhost/api/users/u-1/portrait') as never,
      { params: Promise.resolve({ userId: 'u-1' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      max_declared_score: 8,
      max_proven_score: 8,
      categories: expect.arrayContaining([
        expect.objectContaining({ canonical_subcategory: 'Late Tchaikovsky' }),
        expect.objectContaining({ canonical_subcategory: 'Bowie-era Glam Rock' }),
      ]),
    });
  });

  it('maintains stable API shapes for own portrait, friend portrait, mastery, and multitudes endpoints', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 'u-1' });
    getPortraitDataMock.mockResolvedValue({
      categories: [
        {
          canonical_subcategory: 'Counterpoint species writing',
          broad_category: 'Music',
          declared_score: 3,
          proven_score: 2,
          proven_score_catchup: 0,
          question_count: 2,
          answer_count: 1,
          difficulty_breakdown: {
            declared: { specialist: 1, moderate: 1, accessible: 0 },
            proven: { specialist: 0, moderate: 1, accessible: 0 },
          },
        },
      ],
      max_declared_score: 3,
      max_proven_score: 2,
    });
    getMasteryDataMock.mockResolvedValue([
      {
        canonical_subcategory: 'Counterpoint species writing',
        current_tier: 'familiar',
        mastery_points: 7,
        tier_reached_at: null,
        season_points_gained: 2,
      },
    ]);
    generateMultitudesCopyMock.mockResolvedValue({ copy: 'Counterpoint species writing', usedFallback: false });

    const ownPortraitResponse = await getOwnPortrait(
      new Request('http://localhost/api/users/u-1/portrait') as never,
      { params: Promise.resolve({ userId: 'u-1' }) },
    );
    expect(ownPortraitResponse.status).toBe(200);
    await expect(ownPortraitResponse.json()).resolves.toEqual({
      categories: [
        expect.objectContaining({
          canonical_subcategory: expect.any(String),
          broad_category: expect.any(String),
          declared_score: expect.any(Number),
          proven_score: expect.any(Number),
          difficulty_breakdown: expect.objectContaining({
            declared: expect.any(Object),
            proven: expect.any(Object),
          }),
        }),
      ],
      max_declared_score: expect.any(Number),
      max_proven_score: expect.any(Number),
    });

    userFindUniqueMock.mockResolvedValue({ portrait_visibility: 'public' });
    getFriendPortraitDataMock.mockResolvedValue({
      categories: [
        {
          canonical_subcategory: 'Counterpoint species writing',
          broad_category: 'Music',
          declared_score: 3,
          proven_score: 2,
          visitor_overlap: {
            has_played_here: true,
            has_correct_here: false,
            questions_answered: 1,
            questions_correct: 0,
            overlap_top_peer_name: null,
          },
        },
      ],
      max_declared_score: 3,
      max_proven_score: 2,
      visitor_unexplored: [{ canonical_subcategory: 'Bach chorales', broad_category: 'Music' }],
    });

    const friendPortraitResponse = await getFriendPortrait(
      { nextUrl: new URL('http://localhost/api/users/u-2/portrait/friend?viewerId=u-1') } as never,
      { params: Promise.resolve({ userId: 'u-2' }) },
    );
    expect(friendPortraitResponse.status).toBe(200);
    await expect(friendPortraitResponse.json()).resolves.toEqual({
      categories: [
        expect.objectContaining({
          canonical_subcategory: expect.any(String),
          visitor_overlap: expect.objectContaining({
            has_played_here: expect.any(Boolean),
            has_correct_here: expect.any(Boolean),
            questions_answered: expect.any(Number),
            questions_correct: expect.any(Number),
            overlap_top_peer_name: null,
          }),
        }),
      ],
      max_declared_score: expect.any(Number),
      max_proven_score: expect.any(Number),
      visitor_unexplored: [
        expect.objectContaining({
          canonical_subcategory: expect.any(String),
          broad_category: expect.any(String),
        }),
      ],
    });

    const masteryResponse = await getMastery(
      new Request('http://localhost/api/users/u-1/mastery') as never,
      { params: Promise.resolve({ userId: 'u-1' }) },
    );
    expect(masteryResponse.status).toBe(200);
    await expect(masteryResponse.json()).resolves.toEqual({
      mastery: [
        expect.objectContaining({
          canonical_subcategory: expect.any(String),
          current_tier: expect.any(String),
          mastery_points: expect.any(Number),
          tier_reached_at: null,
          season_points_gained: expect.any(Number),
        }),
      ],
    });

    const multitudesResponse = await postMultitudes(
      new Request('http://localhost/api/users/u-1/portrait/multitudes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portrait_state: 'sparse',
          top_categories: [{ canonical_subcategory: 'Counterpoint species writing', tier: 'familiar' }],
        }),
      }) as never,
      { params: Promise.resolve({ userId: 'u-1' }) },
    );
    expect(multitudesResponse.status).toBe(200);
    await expect(multitudesResponse.json()).resolves.toEqual({
      copy: expect.any(String),
      cached: expect.any(Boolean),
      fallback: expect.any(Boolean),
    });
  });

  it('enforces friend portrait privacy + viewer guardrails', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 'viewer-1' });

    const forbidden = await getFriendPortrait(
      { nextUrl: new URL('http://localhost/api/users/u-2/portrait/friend?viewerId=other-viewer') } as never,
      { params: Promise.resolve({ userId: 'u-2' }) },
    );
    expect(forbidden.status).toBe(403);

    userFindUniqueMock.mockResolvedValueOnce({ portrait_visibility: 'private' });

    const privateResponse = await getFriendPortrait(
      { nextUrl: new URL('http://localhost/api/users/u-2/portrait/friend?viewerId=viewer-1') } as never,
      { params: Promise.resolve({ userId: 'u-2' }) },
    );
    expect(privateResponse.status).toBe(404);
    await expect(privateResponse.json()).resolves.toMatchObject({
      error: 'not_found',
      message: 'This portrait is private.',
    });
  });

  it('returns friend overlap + unexplored payload when portrait is visible', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 'viewer-1' });
    userFindUniqueMock.mockResolvedValue({ portrait_visibility: 'public' });
    getFriendPortraitDataMock.mockResolvedValue({
      categories: [
        {
          canonical_subcategory: 'Late Tchaikovsky',
          broad_category: 'Music',
          declared_score: 8,
          proven_score: 6,
          visitor_overlap: {
            has_played_here: true,
            has_correct_here: true,
            questions_answered: 3,
            questions_correct: 2,
            overlap_top_peer_name: null,
          },
        },
      ],
      max_declared_score: 8,
      max_proven_score: 6,
      visitor_unexplored: [{ canonical_subcategory: 'Counterpoint species writing', broad_category: 'Music Theory' }],
    });

    const response = await getFriendPortrait(
      { nextUrl: new URL('http://localhost/api/users/u-2/portrait/friend') } as never,
      { params: Promise.resolve({ userId: 'u-2' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      categories: [
        expect.objectContaining({
          canonical_subcategory: 'Late Tchaikovsky',
          visitor_overlap: expect.objectContaining({ has_correct_here: true }),
        }),
      ],
      visitor_unexplored: [expect.objectContaining({ canonical_subcategory: 'Counterpoint species writing' })],
    });
    expect(getFriendPortraitDataMock).toHaveBeenCalledWith('u-2', 'viewer-1');
  });


  it('forbids posting multitudes copy for another user id', async () => {
    getCurrentUserMock.mockResolvedValueOnce({ id: 'viewer-1' });

    const response = await postMultitudes(
      new Request('http://localhost/api/users/u-2/portrait/multitudes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ top_categories: [{ canonical_subcategory: 'Late Bach', tier: 'mastery' }] }),
      }) as never,
      { params: Promise.resolve({ userId: 'u-2' }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('returns multitudes copy payload shape for owner requests', async () => {
    getCurrentUserMock.mockResolvedValueOnce({ id: 'u-2' });
    generateMultitudesCopyMock.mockResolvedValueOnce({ copy: 'Late Bach · Weimar Cinema', usedFallback: false });

    const response = await postMultitudes(
      new Request('http://localhost/api/users/u-2/portrait/multitudes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portrait_state: 'developing',
          top_categories: [{ canonical_subcategory: 'Late Bach', tier: 'mastery' }],
        }),
      }) as never,
      { params: Promise.resolve({ userId: 'u-2' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      copy: 'Late Bach · Weimar Cinema',
      cached: false,
      fallback: false,
    });
    expect(setCachedMultitudesCopyMock).toHaveBeenCalledWith('cache-key', 'Late Bach · Weimar Cinema');
  });

  it('returns mastery tier rows for category labels', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 'viewer-1' });
    getMasteryDataMock.mockResolvedValue([
      {
        canonical_subcategory: 'Late Tchaikovsky',
        current_tier: 'mastery',
        mastery_points: 44,
        tier_reached_at: '2026-04-08T00:00:00.000Z',
        season_points_gained: 5,
      },
    ]);

    const response = await getMastery(
      new Request('http://localhost/api/users/u-2/mastery') as never,
      { params: Promise.resolve({ userId: 'u-2' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mastery: [
        {
          canonical_subcategory: 'Late Tchaikovsky',
          current_tier: 'mastery',
          mastery_points: 44,
          tier_reached_at: '2026-04-08T00:00:00.000Z',
          season_points_gained: 5,
        },
      ],
    });
  });
});
