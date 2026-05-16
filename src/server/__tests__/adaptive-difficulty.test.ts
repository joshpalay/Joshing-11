import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ db: {}, users: {}, userDomainDifficulties: {} }));

import {
  applyAdaptiveLevelAdjustment,
  computeDomainDifficultyStep,
  type DomainDifficultyState,
} from '@/server/adaptive-difficulty';

describe('applyAdaptiveLevelAdjustment — global adaptive level', () => {
  it('increases level when correct rate is above 75%', () => {
    expect(applyAdaptiveLevelAdjustment(1.0, 0.76)).toBe(1.2);
    expect(applyAdaptiveLevelAdjustment(2.0, 1.0)).toBe(2.2);
  });

  it('decreases level when correct rate is below 45%', () => {
    expect(applyAdaptiveLevelAdjustment(2.0, 0.44)).toBe(1.8);
    expect(applyAdaptiveLevelAdjustment(2.0, 0.0)).toBe(1.8);
  });

  it('leaves level unchanged when correct rate is in the 45–75% sweet spot', () => {
    expect(applyAdaptiveLevelAdjustment(2.0, 0.45)).toBe(2.0);
    expect(applyAdaptiveLevelAdjustment(2.0, 0.60)).toBe(2.0);
    expect(applyAdaptiveLevelAdjustment(2.0, 0.75)).toBe(2.0);
  });

  it('clamps at MIN_ADAPTIVE_LEVEL (1.0) — cannot go below floor', () => {
    expect(applyAdaptiveLevelAdjustment(1.0, 0.0)).toBe(1.0);
  });

  it('clamps at MAX_ADAPTIVE_LEVEL (4.0) — cannot exceed ceiling', () => {
    expect(applyAdaptiveLevelAdjustment(4.0, 1.0)).toBe(4.0);
  });
});

describe('computeDomainDifficultyStep — per-domain streak tracking', () => {
  const state = (
    servedDifficulty: DomainDifficultyState['servedDifficulty'],
    consecutiveCorrect = 0,
    consecutiveIncorrect = 0,
  ): DomainDifficultyState => ({ servedDifficulty, consecutiveCorrect, consecutiveIncorrect });

  describe('correct answers make it harder', () => {
    it('first correct answer increments streak but leaves difficulty unchanged', () => {
      const result = computeDomainDifficultyStep(state('accessible', 0, 0), true);
      expect(result.servedDifficulty).toBe('accessible');
      expect(result.consecutiveCorrect).toBe(1);
      expect(result.consecutiveIncorrect).toBe(0);
    });

    it('second consecutive correct steps difficulty UP and resets streak', () => {
      const result = computeDomainDifficultyStep(state('accessible', 1, 0), true);
      expect(result.servedDifficulty).toBe('moderate');
      expect(result.consecutiveCorrect).toBe(0);
    });

    it('steps from moderate to specialist after two consecutive correct', () => {
      const result = computeDomainDifficultyStep(state('moderate', 1, 0), true);
      expect(result.servedDifficulty).toBe('specialist');
      expect(result.consecutiveCorrect).toBe(0);
    });

    it('cannot step above specialist', () => {
      const result = computeDomainDifficultyStep(state('specialist', 1, 0), true);
      expect(result.servedDifficulty).toBe('specialist');
      expect(result.consecutiveCorrect).toBe(2);
    });
  });

  describe('incorrect answers make it easier', () => {
    it('first incorrect answer increments streak but leaves difficulty unchanged', () => {
      const result = computeDomainDifficultyStep(state('specialist', 0, 0), false);
      expect(result.servedDifficulty).toBe('specialist');
      expect(result.consecutiveIncorrect).toBe(1);
      expect(result.consecutiveCorrect).toBe(0);
    });

    it('second consecutive incorrect steps difficulty DOWN and resets streak', () => {
      const result = computeDomainDifficultyStep(state('specialist', 0, 1), false);
      expect(result.servedDifficulty).toBe('moderate');
      expect(result.consecutiveIncorrect).toBe(0);
    });

    it('steps from moderate to accessible after two consecutive incorrect', () => {
      const result = computeDomainDifficultyStep(state('moderate', 0, 1), false);
      expect(result.servedDifficulty).toBe('accessible');
      expect(result.consecutiveIncorrect).toBe(0);
    });

    it('cannot step below accessible', () => {
      const result = computeDomainDifficultyStep(state('accessible', 0, 1), false);
      expect(result.servedDifficulty).toBe('accessible');
      expect(result.consecutiveIncorrect).toBe(2);
    });
  });

  describe('streak resets on direction change', () => {
    it('correct answer resets the incorrect streak', () => {
      const result = computeDomainDifficultyStep(state('moderate', 0, 1), true);
      expect(result.consecutiveIncorrect).toBe(0);
      expect(result.consecutiveCorrect).toBe(1);
    });

    it('incorrect answer resets the correct streak', () => {
      const result = computeDomainDifficultyStep(state('moderate', 1, 0), false);
      expect(result.consecutiveCorrect).toBe(0);
      expect(result.consecutiveIncorrect).toBe(1);
    });
  });
});
