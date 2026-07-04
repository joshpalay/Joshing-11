import { describe, expect, it } from 'vitest';

import { masteryBucketKey, recomputeMastery, type MasteryEventInput } from '@/server/mastery/recompute';

const k = masteryBucketKey;

// A resolver backed by a plain map: questionId → current domain label.
const resolverFrom = (map: Record<string, string>) => (qid: string) => map[qid] ?? null;

const ev = (e: Partial<MasteryEventInput> & Pick<MasteryEventInput, 'userId'>): MasteryEventInput => ({
  canonicalSubcategory: 'Some Domain',
  questionId: null,
  sourceType: 'live_correct',
  awardedPoints: 0,
  ...e,
});

describe('recomputeMastery — projection over current taxonomy', () => {
  it('sums awarded points per (user, folded domain)', () => {
    const out = recomputeMastery(
      [
        ev({ userId: 'u1', canonicalSubcategory: 'Hamlet', awardedPoints: 40 }),
        ev({ userId: 'u1', canonicalSubcategory: 'Hamlet', awardedPoints: 60 }),
        ev({ userId: 'u2', canonicalSubcategory: 'Hamlet', awardedPoints: 10 }),
      ],
      () => null,
    );
    expect(out.get(k('u1', 'Hamlet'))?.totalPoints).toBe(100);
    expect(out.get(k('u1', 'Hamlet'))?.eventCount).toBe(2);
    expect(out.get(k('u2', 'Hamlet'))?.totalPoints).toBe(10);
  });

  it('RE-BUCKETS by the question current domain, not the stored snapshot', () => {
    // Event was tagged "Shakespearean Tragedy" at write time; its question now
    // lives in "King Lear" — the points must follow to King Lear.
    const out = recomputeMastery(
      [ev({ userId: 'u1', canonicalSubcategory: 'Shakespearean Tragedy', questionId: 'q1', awardedPoints: 50 })],
      resolverFrom({ q1: 'King Lear' }),
    );
    expect(out.has(k('u1', 'Shakespearean Tragedy'))).toBe(false);
    expect(out.get(k('u1', 'King Lear'))?.totalPoints).toBe(50);
  });

  it('falls back to the stored snapshot for null or unresolvable question ids', () => {
    const out = recomputeMastery(
      [
        ev({ userId: 'u1', canonicalSubcategory: 'Bot Domain', questionId: null, awardedPoints: 5 }),
        ev({ userId: 'u1', canonicalSubcategory: 'Bot Domain', questionId: 'gone', awardedPoints: 5 }),
      ],
      () => null, // nothing resolves
    );
    expect(out.get(k('u1', 'Bot Domain'))?.totalPoints).toBe(10);
  });

  it('folds spelling/case variants of the current domain into one bucket', () => {
    const out = recomputeMastery(
      [
        ev({ userId: 'u1', canonicalSubcategory: 'The Golden Girls', awardedPoints: 30 }),
        ev({ userId: 'u1', canonicalSubcategory: 'the golden girls', awardedPoints: 20 }),
      ],
      () => null,
    );
    expect(out.size).toBe(1);
    expect(out.get(k('u1', 'The Golden Girls'))?.totalPoints).toBe(50);
  });

  it('reproduces the author-credit gate on Mastery via effectiveTier', () => {
    // 2100 points but no author credit → capped at solid.
    const noCredit = recomputeMastery(
      [ev({ userId: 'u1', canonicalSubcategory: 'X', awardedPoints: 2100 })],
      () => null,
    );
    expect(noCredit.get(k('u1', 'X'))?.tier).toBe('solid');

    // 2100 points with ≥20% from ≥2 distinct authored questions → mastery.
    const credited = recomputeMastery(
      [
        ev({ userId: 'u1', canonicalSubcategory: 'X', awardedPoints: 1600 }),
        ev({ userId: 'u1', canonicalSubcategory: 'X', questionId: 'a1', sourceType: 'author_credit', awardedPoints: 300 }),
        ev({ userId: 'u1', canonicalSubcategory: 'X', questionId: 'a2', sourceType: 'author_credit', awardedPoints: 200 }),
      ],
      () => null,
    );
    const entry = credited.get(k('u1', 'X'));
    expect(entry?.totalPoints).toBe(2100);
    expect(entry?.authorCreditPoints).toBe(500);
    expect(entry?.authorCreditDistinctQuestions).toBe(2);
    expect(entry?.tier).toBe('mastery');
  });

  it('caps at solid when author credit comes from a single question', () => {
    const out = recomputeMastery(
      [
        ev({ userId: 'u1', canonicalSubcategory: 'X', awardedPoints: 1500 }),
        ev({ userId: 'u1', canonicalSubcategory: 'X', questionId: 'a1', sourceType: 'author_credit', awardedPoints: 600 }),
      ],
      () => null,
    );
    expect(out.get(k('u1', 'X'))?.authorCreditDistinctQuestions).toBe(1);
    expect(out.get(k('u1', 'X'))?.tier).toBe('solid'); // ≥20% share but <2 distinct
  });

  it('applies lower tiers from points alone', () => {
    const out = recomputeMastery(
      [
        ev({ userId: 'u1', canonicalSubcategory: 'A', awardedPoints: 50 }), // establishing
        ev({ userId: 'u2', canonicalSubcategory: 'B', awardedPoints: 250 }), // familiar
      ],
      () => null,
    );
    expect(out.get(k('u1', 'A'))?.tier).toBe('establishing');
    expect(out.get(k('u2', 'B'))?.tier).toBe('familiar');
  });
});
