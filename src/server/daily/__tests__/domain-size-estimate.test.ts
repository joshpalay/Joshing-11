import { describe, expect, it } from 'vitest';

import {
  SIZE_CEIL,
  SIZE_FLOOR,
  normalizeToQuestionEstimate,
} from '@/server/daily/domain-size-estimate';

describe('normalizeToQuestionEstimate (locked size model)', () => {
  it('scales counted entities by the per-shape constant', () => {
    // single_work K=3: Hamlet (39 sections) → 117, Wagner (25) → 75
    expect(normalizeToQuestionEstimate('single_work', 39)).toBe(117);
    expect(normalizeToQuestionEstimate('single_work', 25)).toBe(75);
    // person_creator K=5: Wallace Stevens (86 works) → 430
    expect(normalizeToQuestionEstimate('person_creator', 86)).toBe(430);
    // abstract K=3: Tudor (34 sections) → 102
    expect(normalizeToQuestionEstimate('abstract_topic', 34)).toBe(102);
  });

  it('clamps a huge franchise signal to the ceiling (never reads as unbounded)', () => {
    // franchise whole-wiki article counts (Star Trek 65k, Star Wars 226k) → CEIL
    expect(normalizeToQuestionEstimate('series_or_franchise', 65_674)).toBe(SIZE_CEIL);
    expect(normalizeToQuestionEstimate('series_or_franchise', 226_923)).toBe(SIZE_CEIL);
  });

  it('applies the floor so a genuinely tiny signal never reads as near-complete-at-zero', () => {
    // 3 sections × 3 = 9, floored to 20
    expect(normalizeToQuestionEstimate('abstract_topic', 3)).toBe(SIZE_FLOOR);
    // just above the floor is preserved
    expect(normalizeToQuestionEstimate('abstract_topic', 13)).toBe(39);
  });

  it('returns null for bespoke and degenerate inputs (caller uses the Haiku depth fallback)', () => {
    expect(normalizeToQuestionEstimate('bespoke', 100)).toBeNull();
    expect(normalizeToQuestionEstimate('abstract_topic', null)).toBeNull();
    expect(normalizeToQuestionEstimate('single_work', 0)).toBeNull();
    expect(normalizeToQuestionEstimate('single_work', -5)).toBeNull();
    expect(normalizeToQuestionEstimate('person_creator', Number.NaN)).toBeNull();
  });

  it('keeps the co-calibration boundary meaningful (seed can be below realized)', () => {
    // Shakespearean Tragedy: 9 sections → seed 27; realized 45 exceeds it, which
    // is what the finiteness state machine reads as "raise the estimate".
    const seed = normalizeToQuestionEstimate('abstract_topic', 9);
    expect(seed).toBe(27);
    expect(45).toBeGreaterThan(seed as number);
  });
});
