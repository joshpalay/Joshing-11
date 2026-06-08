import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({
  db: {},
  users: {},
  userDomainDifficulties: {},
  declaredInterests: {},
  playerMastery: {},
}));

import {
  applyAdaptiveLevelAdjustment,
  applyFocusFloor,
  computeDomainDifficultyStep,
  mapAdaptiveLevelToDifficultyHint,
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

describe('applyFocusFloor — opted-in domains start at least Familiar', () => {
  it('raises an accessible seed to moderate for a focus domain', () => {
    // A player who stated this area of focus (or accepted it from a friend)
    // should never open on "Establishing" trivia.
    expect(applyFocusFloor('accessible', true)).toBe('moderate');
  });

  it('leaves accessible alone when the domain is not a focus area', () => {
    expect(applyFocusFloor('accessible', false)).toBe('accessible');
  });

  it('never lowers a seed that already sits above the floor', () => {
    expect(applyFocusFloor('moderate', true)).toBe('moderate');
    expect(applyFocusFloor('specialist', true)).toBe('specialist');
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

  // PRD-D-5 §5.2 — the declared erosion hard floor. A declared domain passes
  // floor='moderate' (engaged-fan); a demonstrated domain passes the default
  // 'accessible' and keeps the full range.
  describe('declared erosion floor (engaged-fan)', () => {
    const MODERATE_FLOOR = 'moderate' as const;

    it('a declared domain never erodes below engaged-fan after repeated wrong answers', () => {
      // Start at specialist and feed nothing but wrong answers.
      let s = state('specialist', 0, 0);
      for (let i = 0; i < 10; i += 1) {
        s = computeDomainDifficultyStep(s, false, MODERATE_FLOOR);
        expect(['moderate', 'specialist']).toContain(s.servedDifficulty);
      }
      // It settles at the floor and stays there — never accessible.
      expect(s.servedDifficulty).toBe('moderate');
    });

    it('declared domain at the floor does not step down on two consecutive wrong', () => {
      const result = computeDomainDifficultyStep(state('moderate', 0, 1), false, MODERATE_FLOOR);
      expect(result.servedDifficulty).toBe('moderate');
      expect(result.consecutiveIncorrect).toBe(2);
    });

    it('declared domain still steps DOWN from specialist to the floor', () => {
      const result = computeDomainDifficultyStep(state('specialist', 0, 1), false, MODERATE_FLOOR);
      expect(result.servedDifficulty).toBe('moderate');
    });

    it('declared domain still climbs above the floor on two consecutive correct', () => {
      const result = computeDomainDifficultyStep(state('moderate', 1, 0), true, MODERATE_FLOOR);
      expect(result.servedDifficulty).toBe('specialist');
    });

    it('a demonstrated domain (default floor) still erodes all the way to accessible', () => {
      let s = state('specialist', 0, 0);
      for (let i = 0; i < 10; i += 1) {
        s = computeDomainDifficultyStep(s, false);
      }
      expect(s.servedDifficulty).toBe('accessible');
    });
  });
});

describe('mapAdaptiveLevelToDifficultyHint — rungs & register', () => {
  it('accessible and engaged-fan no longer model a "casually interested person"', () => {
    const accessible = mapAdaptiveLevelToDifficultyHint(1.0);
    const engagedFan = mapAdaptiveLevelToDifficultyHint(2.0);
    expect(accessible.promptHint).not.toMatch(/casually interested/i);
    expect(engagedFan.promptHint).not.toMatch(/casually interested/i);
    expect(accessible.targetCorrectRate).toBe(0.78);
    expect(engagedFan.targetCorrectRate).toBe(0.62);
  });

  it('exposes a new enthusiast rung between engaged-fan and specialist (≈0.50 target)', () => {
    const enthusiast = mapAdaptiveLevelToDifficultyHint(2.7);
    expect(enthusiast.difficultyLabel).toBe('enthusiast');
    expect(enthusiast.targetCorrectRate).toBe(0.5);
    // Drift Risk 1 guardrail: the definition is the calibration anchor.
    expect(enthusiast.promptHint).toMatch(/chose to learn/i);
    expect(enthusiast.promptHint).toMatch(/NOT scholar- or archivist-level minutiae/);
  });

  it('the three hardest rungs all target the specialist generator tier', () => {
    expect(mapAdaptiveLevelToDifficultyHint(2.7).estimate).toBe('specialist'); // enthusiast
    expect(mapAdaptiveLevelToDifficultyHint(3.2).estimate).toBe('specialist'); // specialist
    expect(mapAdaptiveLevelToDifficultyHint(4.0).estimate).toBe('specialist'); // expert
  });

  it('preserves the engaged-fan band so the per-domain moderate tier maps to 0.62', () => {
    // SERVED_TO_PREFERENCE: moderate → 'moderate' → level 2.0 lands engaged-fan.
    expect(mapAdaptiveLevelToDifficultyHint(2.0).targetCorrectRate).toBe(0.62);
    // challenging → level 3.0 still lands specialist (0.35), not enthusiast.
    expect(mapAdaptiveLevelToDifficultyHint(3.0).targetCorrectRate).toBe(0.35);
  });
});
