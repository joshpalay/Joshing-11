import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPortraitDataMock,
  answerFindManyMock,
  userFindManyMock,
} = vi.hoisted(() => ({
  getPortraitDataMock: vi.fn(),
  answerFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
}));

vi.mock('@/server/profile/portrait', () => ({
  getPortraitData: getPortraitDataMock,
}));

import { getFriendPortraitData } from '@/server/profile/friend';

describe('friend portrait data shaping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('limits visitor_unexplored to 50 categories and maps overlap counters', async () => {
    const ownerCategories = [
      {
        canonical_subcategory: 'Late Tchaikovsky',
        broad_category: 'Music',
        declared_score: 5,
        proven_score: 4,
        proven_score_catchup: 0,
        question_count: 0,
        answer_count: 0,
        difficulty_breakdown: {
          declared: { accessible: 0, moderate: 0, specialist: 1 },
          proven: { accessible: 0, moderate: 1, specialist: 0 },
        },
      },
    ];

    const viewerCategories = Array.from({ length: 55 }, (_, index) => ({
      canonical_subcategory: `Viewer category ${index + 1}`,
      broad_category: 'History',
      declared_score: 1,
      proven_score: 1,
      proven_score_catchup: 0,
      question_count: 0,
      answer_count: 0,
      difficulty_breakdown: {
        declared: { accessible: 1, moderate: 0, specialist: 0 },
        proven: { accessible: 0, moderate: 1, specialist: 0 },
      },
    }));

    getPortraitDataMock
      .mockResolvedValueOnce({ categories: ownerCategories, max_declared_score: 5, max_proven_score: 4 })
      .mockResolvedValueOnce({ categories: viewerCategories, max_declared_score: 1, max_proven_score: 1 });

    answerFindManyMock.mockResolvedValueOnce([
      { result: 'correct', question: { canonical_subcategory: 'Late Tchaikovsky' } },
      { result: 'wrong', question: { canonical_subcategory: 'Late Tchaikovsky' } },
    ]);
    userFindManyMock.mockReset();

    const result = await getFriendPortraitData('owner-1', 'viewer-1');

    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].visitor_overlap).toEqual({
      has_played_here: true,
      has_correct_here: true,
      questions_answered: 2,
      questions_correct: 1,
      overlap_top_peer_name: null,
    });
    expect(result.visitor_unexplored).toHaveLength(50);
    expect(result.visitor_unexplored[0].canonical_subcategory).toBe('Viewer category 1');
    expect(result.visitor_unexplored[49].canonical_subcategory).toBe('Viewer category 50');
  });

  it('keeps friend overlap behavior neutral when the viewer has no answer history in owner categories', async () => {
    getPortraitDataMock
      .mockResolvedValueOnce({
        categories: [
          {
            canonical_subcategory: 'Roman legal codification',
            broad_category: 'History',
            declared_score: 4,
            proven_score: 2,
            proven_score_catchup: 0,
            question_count: 0,
            answer_count: 0,
            difficulty_breakdown: {
              declared: { accessible: 0, moderate: 1, specialist: 1 },
              proven: { accessible: 1, moderate: 0, specialist: 0 },
            },
          },
          {
            canonical_subcategory: 'Byzantine hymnography',
            broad_category: 'Music',
            declared_score: 3,
            proven_score: 2,
            proven_score_catchup: 0,
            question_count: 0,
            answer_count: 0,
            difficulty_breakdown: {
              declared: { accessible: 1, moderate: 0, specialist: 1 },
              proven: { accessible: 1, moderate: 0, specialist: 0 },
            },
          },
        ],
        max_declared_score: 4,
        max_proven_score: 2,
      })
      .mockResolvedValueOnce({
        categories: [
          {
            canonical_subcategory: 'Byzantine hymnography',
            broad_category: 'Music',
            declared_score: 2,
            proven_score: 1,
            proven_score_catchup: 0,
            question_count: 0,
            answer_count: 0,
            difficulty_breakdown: {
              declared: { accessible: 1, moderate: 0, specialist: 0 },
              proven: { accessible: 1, moderate: 0, specialist: 0 },
            },
          },
        ],
        max_declared_score: 2,
        max_proven_score: 1,
      });

    answerFindManyMock.mockResolvedValueOnce([]);
    const result = await getFriendPortraitData('owner-2', 'viewer-2');

    expect(result.categories).toEqual([
      expect.objectContaining({
        canonical_subcategory: 'Roman legal codification',
        visitor_overlap: {
          has_played_here: false,
          has_correct_here: false,
          questions_answered: 0,
          questions_correct: 0,
          overlap_top_peer_name: null,
        },
      }),
      expect.objectContaining({
        canonical_subcategory: 'Byzantine hymnography',
        visitor_overlap: {
          has_played_here: false,
          has_correct_here: false,
          questions_answered: 0,
          questions_correct: 0,
          overlap_top_peer_name: null,
        },
      }),
    ]);
    expect(result.visitor_unexplored).toEqual([]);
  });
});
