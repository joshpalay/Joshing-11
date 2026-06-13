import { describe, expect, it } from 'vitest';

import { mergeQuestionStats } from '@/server/db/queries/questions';

// mergeQuestionStats is the pure core of the batched readQuestionStatsForIds: it
// merges the three GROUP BY result sets (joshing-game responses, "Send to friend"
// feed answers, and game-usage rows) into per-question stats. These tests pin the
// count-combining, correctRate rounding, and zero-fill semantics that the old
// per-question readQuestionStats used to produce one row at a time.

const lastUsed = new Date('2026-01-15T12:00:00.000Z');

describe('mergeQuestionStats', () => {
  it('sums response and feed answers for the same question', () => {
    const stats = mergeQuestionStats(
      ['q1'],
      [{ questionId: 'q1', timesAnswered: 4, timesCorrect: 3 }],
      [{ questionId: 'q1', timesAnswered: 2, timesCorrect: 1 }],
      [{ questionId: 'q1', lastUsedAt: lastUsed, usedInGamesCount: 5 }],
    );

    expect(stats.get('q1')).toEqual({
      timesAnswered: 6,
      timesCorrect: 4,
      correctRate: 67, // round(4 / 6 * 100)
      lastUsedAt: lastUsed.toISOString(),
      usedInGamesCount: 5,
    });
  });

  it('zero-fills every requested id with no answers or usage', () => {
    const stats = mergeQuestionStats(['q1', 'q2'], [], [], [
      { questionId: 'q1', lastUsedAt: lastUsed, usedInGamesCount: 1 },
    ]);

    expect(stats.get('q1')).toEqual({
      timesAnswered: 0,
      timesCorrect: 0,
      correctRate: 0,
      lastUsedAt: lastUsed.toISOString(),
      usedInGamesCount: 1,
    });
    // q2 has no rows at all — still present, fully zero-filled.
    expect(stats.get('q2')).toEqual({
      timesAnswered: 0,
      timesCorrect: 0,
      correctRate: 0,
      lastUsedAt: null,
      usedInGamesCount: 0,
    });
  });

  it('keeps stats partitioned per question (no cross-contamination)', () => {
    const stats = mergeQuestionStats(
      ['q1', 'q2'],
      [
        { questionId: 'q1', timesAnswered: 1, timesCorrect: 1 },
        { questionId: 'q2', timesAnswered: 3, timesCorrect: 0 },
      ],
      [{ questionId: 'q2', timesAnswered: 1, timesCorrect: 1 }],
      [],
    );

    expect(stats.get('q1')).toMatchObject({ timesAnswered: 1, timesCorrect: 1, correctRate: 100 });
    expect(stats.get('q2')).toMatchObject({
      timesAnswered: 4,
      timesCorrect: 1,
      correctRate: 25,
      usedInGamesCount: 0,
    });
  });

  it('coerces string counts from pg and ignores null questionIds', () => {
    const stats = mergeQuestionStats(
      ['q1'],
      // pg returns count(*) as a string; null questionId rows must be skipped.
      [
        { questionId: 'q1', timesAnswered: '3' as unknown as number, timesCorrect: '2' as unknown as number },
        { questionId: null, timesAnswered: 99, timesCorrect: 99 },
      ],
      [],
      [{ questionId: null, lastUsedAt: lastUsed, usedInGamesCount: 7 }],
    );

    expect(stats.get('q1')).toEqual({
      timesAnswered: 3,
      timesCorrect: 2,
      correctRate: 67,
      lastUsedAt: null,
      usedInGamesCount: 0,
    });
  });

  it('returns an empty map when no ids are requested', () => {
    expect(mergeQuestionStats([], [], [], []).size).toBe(0);
  });
});
