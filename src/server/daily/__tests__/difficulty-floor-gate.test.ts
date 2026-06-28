import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// generate-questions.ts imports @/server/db, which throws at module load without
// a connection string. findUnderDifficultyQuestions never touches the DB; a dummy
// URL plus dynamic import (the repo convention) keeps the unit pure.
let findUnderDifficultyQuestions: typeof import('@/server/daily/generate-questions').findUnderDifficultyQuestions;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ findUnderDifficultyQuestions } = await import('@/server/daily/generate-questions'));
});

type Difficulty = 'accessible' | 'moderate' | 'specialist';

// Minimal stand-in for the LlmQuestion shape the gate reads. Only
// canonical_subcategory and difficulty_estimate matter here.
function q(canonical_subcategory: string, difficulty_estimate: Difficulty) {
  return {
    canonical_subcategory,
    broad_category: 'Television',
    question_text: 'What color is Elmo?',
    answer: 'Red',
    explainer: '',
    difficulty_estimate,
    fact_key: null,
    sub_angles: [],
    question_shape: null,
  };
}

describe('findUnderDifficultyQuestions', () => {
  it('drops the reported case: specialist requested, accessible returned', () => {
    const overrides = new Map([['Sesame Street', 'challenging']]); // → specialist
    const result = findUnderDifficultyQuestions(
      [q('Sesame Street', 'accessible')],
      overrides,
      'adaptive',
    );
    expect([...result.toDrop]).toEqual([0]);
    expect(result.reasons[0]).toContain('Sesame Street');
    expect(result.reasons[0]).toContain('accessible');
  });

  it('keeps a one-rung miss (specialist requested, moderate returned)', () => {
    const overrides = new Map([['Sesame Street', 'challenging']]);
    const result = findUnderDifficultyQuestions(
      [q('Sesame Street', 'moderate')],
      overrides,
      'adaptive',
    );
    expect(result.toDrop.size).toBe(0);
  });

  it('keeps a one-rung miss (moderate requested, accessible returned)', () => {
    const overrides = new Map([['Sesame Street', 'moderate']]);
    const result = findUnderDifficultyQuestions(
      [q('Sesame Street', 'accessible')],
      overrides,
      'adaptive',
    );
    expect(result.toDrop.size).toBe(0);
  });

  it('resolves the override key case/whitespace-insensitively', () => {
    const overrides = new Map([['Sesame Street', 'challenging']]);
    const result = findUnderDifficultyQuestions(
      [q('  sesame street  ', 'accessible')],
      overrides,
      'adaptive',
    );
    expect([...result.toDrop]).toEqual([0]);
  });

  it('falls back to a fixed global preference when no override matches the domain', () => {
    // Fixed-difficulty mode passes no override map; the global preference is the
    // floor for every domain.
    const result = findUnderDifficultyQuestions(
      [q('Sesame Street', 'accessible')],
      undefined,
      'challenging', // → specialist
    );
    expect([...result.toDrop]).toEqual([0]);
  });

  it('enforces nothing when the preference is unresolved adaptive with no override', () => {
    const result = findUnderDifficultyQuestions(
      [q('Sesame Street', 'accessible')],
      new Map(), // domain not present
      'adaptive',
    );
    expect(result.toDrop.size).toBe(0);
  });

  it('enforces nothing when there is no preference at all', () => {
    const result = findUnderDifficultyQuestions(
      [q('Sesame Street', 'accessible')],
      undefined,
      undefined,
    );
    expect(result.toDrop.size).toBe(0);
  });

  it('only flags the under-difficulty entries within a mixed batch', () => {
    const overrides = new Map([
      ['Sesame Street', 'challenging'], // specialist
      ['Wagner’s Ring Cycle', 'moderate'],
      ['Shakespearean Tragedy', 'challenging'], // specialist
    ]);
    const result = findUnderDifficultyQuestions(
      [
        q('Sesame Street', 'accessible'), // 2 below → drop
        q('Wagner’s Ring Cycle', 'moderate'), // on target → keep
        q('Shakespearean Tragedy', 'specialist'), // on target → keep
      ],
      overrides,
      'adaptive',
    );
    expect([...result.toDrop].sort()).toEqual([0]);
  });
});

describe('findUnderDifficultyQuestions — MAX_TIER_SHORTFALL env knob', () => {
  const KEY = 'MAX_TIER_SHORTFALL';
  const saved = process.env[KEY];
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  const specialistRequestedAccessibleReturned = () =>
    findUnderDifficultyQuestions(
      [q('Sesame Street', 'accessible')],
      new Map([['Sesame Street', 'challenging']]), // → specialist (a 2-rung miss)
      'adaptive',
    );

  it('default (unset → 1): the 2-rung miss is flagged', () => {
    delete process.env[KEY];
    expect([...specialistRequestedAccessibleReturned().toDrop]).toEqual([0]);
  });

  it('MAX_TIER_SHORTFALL=2: the same 2-rung miss is tolerated (not flagged)', () => {
    process.env[KEY] = '2';
    expect(specialistRequestedAccessibleReturned().toDrop.size).toBe(0);
  });
});
