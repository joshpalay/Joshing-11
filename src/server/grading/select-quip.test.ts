import { describe, expect, it } from 'vitest';

import {
  DAILY_CORRECT,
  DAILY_WRONG,
  FEED_BOTH_CORRECT,
  FEED_BOTH_WRONG,
  FEED_YOU_CORRECT_FRIEND_WRONG,
  FEED_YOU_WRONG_FRIEND_CORRECT,
  selectQuip,
} from './select-quip';

function wordCount(s: string): number {
  return s.replace(/\{name\}/g, 'X').trim().split(/\s+/).length;
}

describe('quip banks — every entry ≤ 8 words', () => {
  const allBanks = [
    ['DAILY_CORRECT', DAILY_CORRECT],
    ['DAILY_WRONG', DAILY_WRONG],
    ['FEED_BOTH_CORRECT', FEED_BOTH_CORRECT],
    ['FEED_YOU_CORRECT_FRIEND_WRONG', FEED_YOU_CORRECT_FRIEND_WRONG],
    ['FEED_YOU_WRONG_FRIEND_CORRECT', FEED_YOU_WRONG_FRIEND_CORRECT],
    ['FEED_BOTH_WRONG', FEED_BOTH_WRONG],
  ] as const;

  for (const [bankName, bank] of allBanks) {
    for (const quip of bank) {
      it(`${bankName}: "${quip}" is ≤ 8 words`, () => {
        expect(wordCount(quip)).toBeLessThanOrEqual(8);
      });
    }
  }
});

describe('selectQuip — returns a string for every valid combination', () => {
  it('daily + correct', () => {
    const result = selectQuip({ isCorrect: true, surface: 'daily', friendResult: null });
    expect(typeof result).toBe('string');
    expect(result!.length).toBeGreaterThan(0);
  });

  it('daily + wrong', () => {
    const result = selectQuip({ isCorrect: false, surface: 'daily', friendResult: null });
    expect(typeof result).toBe('string');
    expect(result!.length).toBeGreaterThan(0);
  });

  it('feed + both correct', () => {
    const result = selectQuip({ isCorrect: true, surface: 'feed', friendResult: 'correct', friendName: 'Alex' });
    expect(FEED_BOTH_CORRECT as readonly string[]).toContain(result);
  });

  it('feed + you correct, friend wrong — substitutes name', () => {
    const result = selectQuip({ isCorrect: true, surface: 'feed', friendResult: 'incorrect', friendName: 'Jordan' });
    expect(typeof result).toBe('string');
    expect(result).not.toContain('{name}');
    expect(result).toSatisfy((s: string) => s.includes('Jordan') || s === "You carried that one.");
  });

  it('feed + you wrong, friend correct — substitutes name', () => {
    const result = selectQuip({ isCorrect: false, surface: 'feed', friendResult: 'correct', friendName: 'Sam' });
    expect(typeof result).toBe('string');
    expect(result).not.toContain('{name}');
    expect(result).toSatisfy((s: string) => s.includes('Sam'));
  });

  it('feed + both wrong', () => {
    const result = selectQuip({ isCorrect: false, surface: 'feed', friendResult: 'incorrect' });
    expect(FEED_BOTH_WRONG as readonly string[]).toContain(result);
  });

  it('feed + no friend result falls back to daily banks', () => {
    const correctResult = selectQuip({ isCorrect: true, surface: 'feed', friendResult: null });
    expect(DAILY_CORRECT as readonly string[]).toContain(correctResult);
    const wrongResult = selectQuip({ isCorrect: false, surface: 'feed', friendResult: null });
    expect(DAILY_WRONG as readonly string[]).toContain(wrongResult);
  });

  it('joshing_game uses feed banks', () => {
    const result = selectQuip({ isCorrect: true, surface: 'joshing_game', friendResult: 'correct' });
    expect(FEED_BOTH_CORRECT as readonly string[]).toContain(result);
  });

  it('joshing_game + no friend result falls back to daily banks', () => {
    const result = selectQuip({ isCorrect: true, surface: 'joshing_game', friendResult: null });
    expect(DAILY_CORRECT as readonly string[]).toContain(result);
  });
});

describe('selectQuip — {name} substitution', () => {
  it('uses "them" as default when friendName is omitted and name needed', () => {
    // Force the branch that requires name substitution by seeding
    const result = selectQuip({ isCorrect: true, surface: 'feed', friendResult: 'incorrect', seed: 0 });
    // seed=0 picks index 0: "You had it. {name} didn't."
    expect(result).toBe("You had it. them didn't.");
  });

  it('substitutes provided name', () => {
    const result = selectQuip({ isCorrect: true, surface: 'feed', friendResult: 'incorrect', friendName: 'Riley', seed: 0 });
    expect(result).toBe("You had it. Riley didn't.");
  });
});

describe('selectQuip — partial (correct) branch', () => {
  it('treats partial/correct the same as correct for daily', () => {
    const result = selectQuip({ isCorrect: true, surface: 'daily', friendResult: null });
    expect(DAILY_CORRECT as readonly string[]).toContain(result);
  });
});

describe('selectQuip — unknown surface throws', () => {
  it('throws for an unknown surface', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      selectQuip({ isCorrect: true, surface: 'unknown' as any, friendResult: null })
    ).toThrow();
  });
});
