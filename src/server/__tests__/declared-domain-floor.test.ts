// R5 (2026-09-11) — DECLARED-domain difficulty floor, DEFAULT OFF.
//
// Declaring an interest is supposed to buy a head start to the engaged-fan rung.
// It does not: 42% of live generated rows in a user's declared domains are
// accessible-tier, against 41% in domains they never chose. See
// audits/2026-09-11-Fable-QUESTION-DRIFT-PIPELINE-01.md §2 P8 / §3.8.
//
// The previous attempt at a floor was a BLANKET one and did real harm (it buried
// good easy questions and pressured the generator into inventing deep cuts for
// shallow topics), so it was recalibrated off on 2026-06-28. These tests exist
// mostly to pin the two properties that make this attempt different: it is off
// unless explicitly enabled, and when off it is byte-for-byte the old behaviour.

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyFocusFloor,
  declaredDomainFloor,
  floorForDomain,
  isDeclaredDomainFloorEnabled,
} from '@/server/adaptive-difficulty';
import { findUnderDifficultyQuestions, type LlmQuestion } from '@/server/daily/generate-questions';

const FLAG = 'DECLARED_DOMAIN_FLOOR_ENABLED';
const FLOOR = 'DECLARED_DOMAIN_FLOOR';
const FOCUS = 'FOCUS_DOMAIN_MIN_DIFFICULTY';

afterEach(() => {
  delete process.env[FLAG];
  delete process.env[FLOOR];
  delete process.env[FOCUS];
});

function q(domain: string, tier: LlmQuestion['difficulty_estimate']): LlmQuestion {
  return {
    canonical_subcategory: domain,
    broad_category: 'Literature',
    question_text: 'Q?',
    answer: 'A',
    explainer: 'E',
    difficulty_estimate: tier,
    fact_key: null,
    subject_entity: null,
    sub_angles: [],
    question_shape: null,
  };
}

describe('declared-domain floor — default posture', () => {
  it('is OFF unless explicitly enabled', () => {
    expect(isDeclaredDomainFloorEnabled()).toBe(false);
  });

  it('stays off for values that are not an affirmative opt-in', () => {
    for (const value of ['false', '0', 'no', 'off', '', 'maybe']) {
      process.env[FLAG] = value;
      expect(isDeclaredDomainFloorEnabled()).toBe(false);
    }
  });

  it('turns on for the usual affirmative spellings', () => {
    for (const value of ['true', '1', 'yes', 'on', 'TRUE']) {
      process.env[FLAG] = value;
      expect(isDeclaredDomainFloorEnabled()).toBe(true);
    }
  });

  it('with the flag off, a declared domain keeps exactly the old floor', () => {
    // Old behaviour: declared domains took focusDomainMinDifficulty(), which
    // itself defaults to 'accessible' (i.e. no floor at all).
    expect(floorForDomain(true)).toBe('accessible');
    process.env[FOCUS] = 'moderate';
    expect(floorForDomain(true)).toBe('moderate');
  });

  it('never floors a demonstrated domain, flag on or off', () => {
    expect(floorForDomain(false)).toBe('accessible');
    process.env[FLAG] = 'true';
    expect(floorForDomain(false)).toBe('accessible');
    // Even with the global focus floor raised, demonstrated territory keeps the
    // full range down to accessible — that was the 2026-06-28 lesson.
    process.env[FOCUS] = 'specialist';
    expect(floorForDomain(false)).toBe('accessible');
  });
});

describe('declared-domain floor — enabled', () => {
  it('floors a declared domain at the engaged-fan rung by default', () => {
    process.env[FLAG] = 'true';
    expect(declaredDomainFloor()).toBe('moderate');
    expect(floorForDomain(true)).toBe('moderate');
  });

  it('honours an explicit override', () => {
    process.env[FLAG] = 'true';
    process.env[FLOOR] = 'specialist';
    expect(floorForDomain(true)).toBe('specialist');
  });

  it('ignores a nonsense override rather than failing the build', () => {
    process.env[FLAG] = 'true';
    process.env[FLOOR] = 'impossible';
    expect(floorForDomain(true)).toBe('moderate');
  });

  it('raises but never lowers — an earned tier survives the floor', () => {
    // applyFocusFloor is a max, so a player who climbed to specialist in a
    // declared domain is not dragged back down to the floor.
    expect(applyFocusFloor('specialist', true, 'moderate')).toBe('specialist');
    expect(applyFocusFloor('accessible', true, 'moderate')).toBe('moderate');
  });
});

describe('difficulty shortfall tolerance (R5)', () => {
  const overrides = new Map([['Hamlet', 'moderate']]);

  it('tolerates a one-rung miss by default, which is what defeats a floor', () => {
    const { toDrop } = findUnderDifficultyQuestions(
      [q('Hamlet', 'accessible')],
      overrides,
      undefined,
    );
    expect(toDrop.size).toBe(0);
  });

  it('gives a strict domain no slack, so the request actually sticks', () => {
    const { toDrop, reasons } = findUnderDifficultyQuestions(
      [q('Hamlet', 'accessible')],
      overrides,
      undefined,
      new Set(['Hamlet']),
    );
    expect([...toDrop]).toEqual([0]);
    expect(reasons[0]).toContain('below requested');
  });

  it('still accepts an in-tier or harder question from a strict domain', () => {
    for (const tier of ['moderate', 'specialist'] as const) {
      const { toDrop } = findUnderDifficultyQuestions(
        [q('Hamlet', tier)],
        overrides,
        undefined,
        new Set(['Hamlet']),
      );
      expect(toDrop.size).toBe(0);
    }
  });

  it('leaves non-strict domains in the same batch on the normal tolerance', () => {
    const { toDrop } = findUnderDifficultyQuestions(
      [q('Hamlet', 'accessible'), q('Macbeth', 'accessible')],
      new Map([
        ['Hamlet', 'moderate'],
        ['Macbeth', 'moderate'],
      ]),
      undefined,
      new Set(['Hamlet']),
    );
    expect([...toDrop]).toEqual([0]);
  });

  it('matches strict domains case-insensitively, as the override lookup does', () => {
    const { toDrop } = findUnderDifficultyQuestions(
      [q('hamlet', 'accessible')],
      new Map([['Hamlet', 'moderate']]),
      undefined,
      new Set(['HAMLET']),
    );
    expect([...toDrop]).toEqual([0]);
  });
});
