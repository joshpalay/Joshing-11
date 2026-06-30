import { afterEach, describe, expect, it, vi } from 'vitest';

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
  computeStarvationStepDown,
  computeSupplyCorrection,
  focusDomainMinDifficulty,
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

describe('applyFocusFloor — opted-in domains, env-tunable floor', () => {
  it('defaults to NO raise (floor accessible): an accessible focus seed stays accessible', () => {
    // RECALIBRATED 2026-06-28: the focus floor defaults to 'accessible', so a focus
    // domain no longer blanket-starts at moderate. Skilled players still seed up via
    // the adaptive-level seed (consulted before this floor); the streak ladder climbs.
    expect(applyFocusFloor('accessible', true)).toBe('accessible');
  });

  it('raises to an explicitly-passed floor (the "never below floor" property holds)', () => {
    expect(applyFocusFloor('accessible', true, 'moderate')).toBe('moderate');
    expect(applyFocusFloor('accessible', true, 'specialist')).toBe('specialist');
    expect(applyFocusFloor('moderate', true, 'specialist')).toBe('specialist');
  });

  it('ignores the floor for non-focus domains, and never lowers an already-higher seed', () => {
    expect(applyFocusFloor('accessible', false)).toBe('accessible');
    expect(applyFocusFloor('accessible', false, 'specialist')).toBe('accessible');
    expect(applyFocusFloor('moderate', true)).toBe('moderate');
    expect(applyFocusFloor('specialist', true)).toBe('specialist');
  });
});

describe('focusDomainMinDifficulty — env knob', () => {
  const KEY = 'FOCUS_DOMAIN_MIN_DIFFICULTY';
  const saved = process.env[KEY];
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('defaults to accessible when unset or garbage', () => {
    delete process.env[KEY];
    expect(focusDomainMinDifficulty()).toBe('accessible');
    process.env[KEY] = 'nonsense';
    expect(focusDomainMinDifficulty()).toBe('accessible');
  });

  it('honors a valid override (restores the old moderate-floor behaviour)', () => {
    process.env[KEY] = 'moderate';
    expect(focusDomainMinDifficulty()).toBe('moderate');
    expect(applyFocusFloor('accessible', true)).toBe('moderate');
    process.env[KEY] = 'specialist';
    expect(focusDomainMinDifficulty()).toBe('specialist');
  });
});

describe('computeSupplyCorrection — easy declared domain can now settle accessible', () => {
  it('pulls a stuck-moderate easy domain down to accessible when the floor is accessible', () => {
    expect(computeSupplyCorrection('moderate', 'accessible', 'accessible')).toBe('accessible');
  });

  it('the OLD moderate floor would have kept it pinned at moderate (no correction)', () => {
    expect(computeSupplyCorrection('moderate', 'accessible', 'moderate')).toBeNull();
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

describe('computeSupplyCorrection — supply-side overshoot correction', () => {
  // The streak ladder can raise a domain to a tier the generator can't field
  // (e.g. specialist Tears of the Kingdom, which does not exist). When the run had
  // to serve a lower tier from the under-difficulty reserve, pull the stored tier
  // down to what we could actually deliver so the next run stops re-gating.

  it('pulls specialist down to the moderate tier we could actually deliver', () => {
    // Butkicker's exact case: asked specialist, only moderate ToTK exists.
    expect(computeSupplyCorrection('specialist', 'moderate', 'accessible')).toBe('moderate');
  });

  it('pulls specialist down to accessible for a demonstrated domain', () => {
    expect(computeSupplyCorrection('specialist', 'accessible', 'accessible')).toBe('accessible');
  });

  it('never demotes a declared domain below its engaged-fan floor', () => {
    // Even if only accessible could be fielded, a declared fan holds at moderate
    // (Part 1 still serves the easier question; we just do not pin below the floor).
    expect(computeSupplyCorrection('specialist', 'accessible', 'moderate')).toBe('moderate');
  });

  it('returns null when the delivered tier already matches the stored tier (no overshoot)', () => {
    expect(computeSupplyCorrection('moderate', 'moderate', 'accessible')).toBeNull();
  });

  it('returns null when delivered is somehow higher than stored — never promotes', () => {
    expect(computeSupplyCorrection('moderate', 'specialist', 'accessible')).toBeNull();
  });

  it('returns null when the only correction would be below the floor (already floored)', () => {
    // Stored sits at the floor; an accessible delivery cannot pull it lower.
    expect(computeSupplyCorrection('moderate', 'accessible', 'moderate')).toBeNull();
  });
});

describe('computeStarvationStepDown — empty-generation deadlock breaker', () => {
  // The counterpart computeSupplyCorrection can't reach: when a domain's requested
  // tier yields LITERALLY NOTHING there is no delivery to learn a ceiling from, so
  // we step down one tier (bounded by the floor) to break the re-fail loop.

  it('steps specialist down one tier to moderate (Buttkicker ToTK deadlock)', () => {
    expect(computeStarvationStepDown('specialist', 'accessible')).toBe('moderate');
  });

  it('steps one tier at a time, not straight to the floor', () => {
    // A second starvation (moderate still empty) is what reaches accessible.
    expect(computeStarvationStepDown('moderate', 'accessible')).toBe('accessible');
  });

  it('respects a declared domain’s engaged-fan floor', () => {
    expect(computeStarvationStepDown('specialist', 'moderate')).toBe('moderate');
    expect(computeStarvationStepDown('moderate', 'moderate')).toBeNull();
  });

  it('returns null when already at or below the floor (nothing left to relax)', () => {
    expect(computeStarvationStepDown('accessible', 'accessible')).toBeNull();
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
