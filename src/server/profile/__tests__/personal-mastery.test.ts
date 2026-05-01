import { describe, expect, it } from 'vitest';
import { getPortraitState } from '@/server/profile/portrait';
import {
  getFriendOverlapLine,
  getResponsiveAxisLabel,
  groupCategoriesByBroadCategory,
  sortCategoriesByTierThenActivity,
  type CategoryRow,
} from '@/server/profile/personal-mastery';

function category(input: Partial<CategoryRow> & Pick<CategoryRow, 'canonical_subcategory'>): CategoryRow {
  return {
    canonical_subcategory: input.canonical_subcategory,
    broad_category: input.broad_category ?? 'Music',
    declared_score: input.declared_score ?? 0,
    proven_score: input.proven_score ?? 0,
    proven_score_catchup: 0,
    emerging_proven: false,
    question_count: 0,
    answer_count: 0,
    authored_answered_count: 0,
    difficulty_breakdown: {
      declared: { accessible: 0, moderate: 0, specialist: 0 },
      proven: { accessible: 0, moderate: 0, specialist: 0 },
    },
    visitor_overlap: input.visitor_overlap,
  };
}

describe('personal mastery helpers', () => {
  it('sorts by tier first and activity second', () => {
    const categories = [
      category({ canonical_subcategory: 'A', declared_score: 3, proven_score: 3 }),
      category({ canonical_subcategory: 'B', declared_score: 8, proven_score: 8 }),
      category({ canonical_subcategory: 'C', declared_score: 1, proven_score: 1 }),
    ];
    const points = new Map<string, number>([
      ['A', 1600],
      ['B', 8],
      ['C', 600],
    ]);

    const sorted = sortCategoriesByTierThenActivity(categories, points);
    expect(sorted.map((row) => row.canonical_subcategory)).toEqual(['A', 'C', 'B']);
  });

  it('groups by broad category and sorts sections by top activity', () => {
    const grouped = groupCategoriesByBroadCategory([
      category({ canonical_subcategory: 'A', broad_category: 'History', declared_score: 1, proven_score: 1 }),
      category({ canonical_subcategory: 'B', broad_category: 'Music', declared_score: 10, proven_score: 2 }),
    ]);

    expect(grouped.map(([name]) => name)).toEqual(['Music', 'History']);
  });

  it('uses expected overlap copy mapping (D2 Element 5 + B10 peer line)', () => {
    expect(getFriendOverlapLine(undefined)).toBe(null);
    expect(
      getFriendOverlapLine({
        has_played_here: false,
        has_correct_here: false,
        questions_answered: 0,
        questions_correct: 0,
        overlap_top_peer_name: null,
      }),
    ).toBe(null);
    expect(
      getFriendOverlapLine({
        has_played_here: true,
        has_correct_here: false,
        questions_answered: 2,
        questions_correct: 0,
        overlap_top_peer_name: null,
      }),
    ).toBe('still finding your footing here');
    expect(
      getFriendOverlapLine({
        has_played_here: true,
        has_correct_here: true,
        questions_answered: 2,
        questions_correct: 1,
        overlap_top_peer_name: null,
      }),
    ).toBe('you know this territory too');
    expect(
      getFriendOverlapLine({
        has_played_here: true,
        has_correct_here: true,
        questions_answered: 2,
        questions_correct: 1,
        overlap_top_peer_name: 'Jordan',
      }),
    ).toBe('You overlap most with Jordan here');
  });

  it('uses full words for responsive axis labels', () => {
    expect(getResponsiveAxisLabel('declared', true)).toBe('declared');
    expect(getResponsiveAxisLabel('proven', true)).toBe('proven');
    expect(getResponsiveAxisLabel('declared', false)).toBe('declared');
  });

  it('returns portrait states for empty sparse developing and rich', () => {
    expect(getPortraitState(0)).toBe('empty');
    expect(getPortraitState(3)).toBe('sparse');
    expect(getPortraitState(10)).toBe('developing');
    expect(getPortraitState(11)).toBe('rich');
  });
});
