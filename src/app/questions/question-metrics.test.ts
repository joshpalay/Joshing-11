import { describe, expect, it } from 'vitest';

import { getQuestionPageMetrics } from './question-metrics';

describe('getQuestionPageMetrics', () => {
  it('counts all received answers and authored questions that have at least one answer', () => {
    expect(
      getQuestionPageMetrics([{ timesAnswered: 3 }, { timesAnswered: 0 }, { timesAnswered: 2 }]),
    ).toEqual({
      answersReceived: 5,
      questionsAnswered: 2,
    });
  });

  it('starts at zero before any authored questions have answers', () => {
    expect(getQuestionPageMetrics([{ timesAnswered: 0 }])).toEqual({
      answersReceived: 0,
      questionsAnswered: 0,
    });
  });
});
