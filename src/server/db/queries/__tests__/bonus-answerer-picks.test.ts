import { describe, expect, it } from 'vitest';

import {
  selectBonusAnswererPicks,
  type BonusAnswererRow,
  type KnowledgeBaseDomain,
} from '@/server/db/queries/daily';

// Knowledge base used across cases: one declared domain ("star wars") whose
// broad category is "film_tv".
const KB: KnowledgeBaseDomain[] = [
  {
    domain: 'Star Wars',
    broadCategory: 'film_tv',
    source: 'declared',
    territoryType: 'declared',
    totalPoints: 0,
    tier: 'establishing',
  },
];

let rowSeq = 0;
function row(overrides: Partial<BonusAnswererRow> = {}): BonusAnswererRow {
  rowSeq += 1;
  return {
    questionId: `q${rowSeq}`,
    answererId: `a${rowSeq}`,
    sourceEventAt: new Date(2026, 0, rowSeq + 1),
    creatorId: `c${rowSeq}`,
    questionText: `question ${rowSeq}`,
    answerText: 'answer',
    alternateAnswers: [],
    factualExplanation: null,
    canonicalSubcategory: 'Star Wars',
    broadCategory: 'film_tv',
    category: 'film_tv',
    calibratedDifficulty: 'accessible',
    llmDifficulty: 'accessible',
    difficultyEstimate: 'accessible',
    creatorNote: null,
    ...overrides,
  };
}

const NO_EXCLUDE = new Set<string>();
const opts = (over: Partial<Parameters<typeof selectBonusAnswererPicks>[1]> = {}) => ({
  knowledgeBase: KB,
  excludeQuestionIds: NO_EXCLUDE,
  answeredQuestionIds: NO_EXCLUDE,
  limit: 2,
  ...over,
});

describe('selectBonusAnswererPicks — accessibility filter', () => {
  it('keeps calibratedDifficulty === accessible', () => {
    const picks = selectBonusAnswererPicks([row({ calibratedDifficulty: 'accessible' })], opts());
    expect(picks).toHaveLength(1);
  });

  it('drops calibratedDifficulty === moderate even if llm is accessible', () => {
    const picks = selectBonusAnswererPicks(
      [row({ calibratedDifficulty: 'moderate', llmDifficulty: 'accessible' })],
      opts(),
    );
    expect(picks).toHaveLength(0);
  });

  it('falls back to llmDifficulty === accessible only when calibrated is null', () => {
    const picks = selectBonusAnswererPicks(
      [row({ calibratedDifficulty: null, llmDifficulty: 'accessible' })],
      opts(),
    );
    expect(picks).toHaveLength(1);
  });

  it('drops when calibrated is null and llm is not accessible', () => {
    const picks = selectBonusAnswererPicks(
      [row({ calibratedDifficulty: null, llmDifficulty: 'specialist' })],
      opts(),
    );
    expect(picks).toHaveLength(0);
  });

  it('always tags surviving picks as accessible difficulty', () => {
    const picks = selectBonusAnswererPicks(
      [row({ calibratedDifficulty: null, llmDifficulty: 'accessible' })],
      opts(),
    );
    expect(picks[0].difficultyEstimate).toBe('accessible');
  });
});

describe('selectBonusAnswererPicks — relevance ranking', () => {
  it('ranks exact subcategory > broadCategory > any, ignoring recency across tiers', () => {
    // "any" row is the newest; subcategory match is the oldest. Tier must win.
    const any = row({
      questionId: 'any',
      canonicalSubcategory: 'Cooking',
      broadCategory: 'food',
      sourceEventAt: new Date(2026, 5, 1),
    });
    const broad = row({
      questionId: 'broad',
      canonicalSubcategory: 'Star Trek',
      broadCategory: 'film_tv',
      sourceEventAt: new Date(2026, 3, 1),
    });
    const exact = row({
      questionId: 'exact',
      canonicalSubcategory: 'Star Wars',
      broadCategory: 'film_tv',
      sourceEventAt: new Date(2026, 0, 1),
    });
    const picks = selectBonusAnswererPicks([any, broad, exact], opts({ limit: 3 }));
    expect(picks.map((p) => p.id)).toEqual(['exact', 'broad', 'any']);
  });

  it('within the same tier, newer sourceEventAt ranks first', () => {
    const older = row({ questionId: 'older', sourceEventAt: new Date(2026, 0, 1) });
    const newer = row({ questionId: 'newer', sourceEventAt: new Date(2026, 6, 1) });
    const picks = selectBonusAnswererPicks([older, newer], opts({ limit: 2 }));
    expect(picks.map((p) => p.id)).toEqual(['newer', 'older']);
  });
});

describe('selectBonusAnswererPicks — caps and dedup', () => {
  it('caps the result at limit (top 2)', () => {
    const picks = selectBonusAnswererPicks([row(), row(), row()], opts({ limit: 2 }));
    expect(picks).toHaveLength(2);
  });

  it('returns nothing when limit <= 0', () => {
    expect(selectBonusAnswererPicks([row(), row()], opts({ limit: 0 }))).toEqual([]);
  });

  it('drops questions already in the core slots (excludeQuestionIds)', () => {
    const picks = selectBonusAnswererPicks(
      [row({ questionId: 'dupe' }), row({ questionId: 'fresh' })],
      opts({ excludeQuestionIds: new Set(['dupe']) }),
    );
    expect(picks.map((p) => p.id)).toEqual(['fresh']);
  });

  it('drops questions the viewer already answered correctly', () => {
    const picks = selectBonusAnswererPicks(
      [row({ questionId: 'solved' }), row({ questionId: 'fresh' })],
      opts({ answeredQuestionIds: new Set(['solved']) }),
    );
    expect(picks.map((p) => p.id)).toEqual(['fresh']);
  });

  it('yields one slot per question, keeping the first (most recent) answerer', () => {
    // Same questionId from two friends; rows are newest-first per the DB ordering.
    const recent = row({ questionId: 'shared', answererId: 'robyn', sourceEventAt: new Date(2026, 6, 1) });
    const older = row({ questionId: 'shared', answererId: 'sam', sourceEventAt: new Date(2026, 0, 1) });
    const picks = selectBonusAnswererPicks([recent, older], opts());
    expect(picks).toHaveLength(1);
    expect(picks[0].answererId).toBe('robyn');
  });

  it('drops generic subcategories', () => {
    const picks = selectBonusAnswererPicks(
      [row({ questionId: 'generic', canonicalSubcategory: 'general' }), row({ questionId: 'real' })],
      opts(),
    );
    expect(picks.map((p) => p.id)).toEqual(['real']);
  });
});
