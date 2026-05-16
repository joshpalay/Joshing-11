import { describe, expect, it } from 'vitest';
import { getDifficultyPoints } from '@/server/mastery/scoring';

/** Mirrors portrait.ts proven score: live 1×, catch-up 0.5× (PRD §8.19 / D3). */
function portraitProvenPoints(difficulty: 'accessible' | 'moderate' | 'specialist', catchUp: boolean): number {
  return getDifficultyPoints(difficulty) * (catchUp ? 0.5 : 1);
}

describe('portrait proven weights', () => {
  it('applies 1× live and 0.5× catch-up on the same calibrated difficulty', () => {
    expect(portraitProvenPoints('moderate', false)).toBe(2);
    expect(portraitProvenPoints('moderate', true)).toBe(1);
  });
});
