import { describe, expect, it } from 'vitest';
import type { CategoryGainsDeltaRow } from '@/server/mastery/category-gains-types';
import { buildSessionCloseCopy } from '@/server/mastery/session-close-copy';

function row(partial: Pick<CategoryGainsDeltaRow, 'subcategory' | 'points_earned'>): CategoryGainsDeltaRow {
  return {
    ...partial,
    points_from_answers: 0,
    points_from_catchup: 0,
    points_from_author_credit: 0,
    points_from_authored: 0,
    total: 0,
    current_tier: 'establishing',
    next_tier: 'familiar',
    progress_pct: 0,
    tier_crossed: false,
    new_tier: null,
  };
}

describe('buildSessionCloseCopy', () => {
  it('omits domains when no movement', () => {
    expect(buildSessionCloseCopy([row({ subcategory: 'History', points_earned: 0 })])).toBe(
      'Done for today. Your next 5 questions arrive tomorrow at noon.',
    );
  });

  it('names one top domain', () => {
    expect(buildSessionCloseCopy([row({ subcategory: 'Film & TV', points_earned: 2 })])).toBe(
      "Done for today. You're building in Film & TV. Your next 5 questions arrive tomorrow at noon.",
    );
  });

  it('names top two domains by points', () => {
    const copy = buildSessionCloseCopy([
      row({ subcategory: 'Alpha', points_earned: 5 }),
      row({ subcategory: 'Beta', points_earned: 3 }),
      row({ subcategory: 'Gamma', points_earned: 1 }),
    ]);
    expect(copy).toBe(
      "Done for today. You're building in Alpha and Beta. Your next 5 questions arrive tomorrow at noon.",
    );
  });
});
