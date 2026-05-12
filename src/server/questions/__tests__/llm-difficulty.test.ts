import { describe, expect, it } from 'vitest';

import { fallbackQuestionDifficulty, parseQuestionDifficultyAssessment } from '@/server/questions/llm-difficulty';

describe('question LLM difficulty assessment', () => {
  it('maps domain-relative tier labels to persisted numeric difficulty', () => {
    expect(parseQuestionDifficultyAssessment('{"tier":"establishing"}')).toEqual({ tier: 'establishing', difficulty: 1 });
    expect(parseQuestionDifficultyAssessment('{"tier":"solid"}')).toEqual({ tier: 'solid', difficulty: 3 });
    expect(parseQuestionDifficultyAssessment('{"tier":"skilled"}')).toEqual({ tier: 'skilled', difficulty: 4 });
    expect(parseQuestionDifficultyAssessment('{"tier":"master"}')).toEqual({ tier: 'master', difficulty: 5 });
  });

  it('accepts mastery as an alias for master', () => {
    expect(parseQuestionDifficultyAssessment('{"difficultyTier":"mastery"}')).toEqual({ tier: 'master', difficulty: 5 });
  });

  it('falls back to solid when no LLM rating is available', () => {
    expect(fallbackQuestionDifficulty()).toEqual({ tier: 'solid', difficulty: 3 });
  });
});
