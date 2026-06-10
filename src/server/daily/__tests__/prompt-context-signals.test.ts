import { beforeAll, describe, expect, it } from 'vitest';

// BP-5 (audit Q3c/Q3d): per-domain mastery strength and the onboarding cultural
// anchor are threaded into buildUserPrompt as SALIENCE context. These tests pin
// the rendering contract: each signal appears when provided (scoped to the
// round's domains), carries its never-difficulty framing, and is absent when
// not provided — so each block is independently revertable.
//
// generate-questions.ts imports @/server/db, which throws at module load
// without a connection string. buildUserPrompt never touches the DB; a dummy
// URL plus dynamic import (the repo convention) keeps the unit pure.
let buildUserPrompt: typeof import('@/server/daily/generate-questions').buildUserPrompt;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ buildUserPrompt } = await import('@/server/daily/generate-questions'));
});

const noPrev: [] = [];

function prompt(
  domains: string[],
  strengths?: ReadonlyMap<string, { tier: 'establishing' | 'familiar' | 'solid' | 'mastery'; totalPoints: number; correctAnswerCount: number }>,
  anchor?: { birthYear: number | null; grewUpCountry: string | null; grewUpRegion: string | null } | null,
): string {
  return buildUserPrompt(
    domains,
    domains.length,
    noPrev,
    noPrev,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    strengths,
    anchor,
  );
}

describe('buildUserPrompt — player strength block (Q3c)', () => {
  it('renders tier/points/correct-count for domains in the round, with the never-difficulty framing', () => {
    const out = prompt(
      ['Wagner\'s Ring Cycle', 'Weimar Cinema'],
      new Map([
        ['Wagner\'s Ring Cycle', { tier: 'solid' as const, totalPoints: 940, correctAnswerCount: 17 }],
        ['Weimar Cinema', { tier: 'establishing' as const, totalPoints: 0, correctAnswerCount: 0 }],
      ]),
    );
    expect(out).toContain("- Wagner's Ring Cycle: solid tier, 940 pts, 17 correct so far");
    expect(out).toContain('- Weimar Cinema: establishing tier, 0 pts, 0 correct so far');
    expect(out).toContain('Do NOT use it to change difficulty');
  });

  it('omits strength entries for domains outside the round, and the whole block when none match', () => {
    const strengths = new Map([
      ['Mrs. Dalloway', { tier: 'mastery' as const, totalPoints: 2100, correctAnswerCount: 40 }],
    ]);
    const out = prompt(['Weimar Cinema'], strengths);
    expect(out).not.toContain('Mrs. Dalloway: mastery');
    expect(out).not.toContain('Player strength in this round');
  });
});

describe('buildUserPrompt — cultural anchor block (Q3d)', () => {
  it('renders era + region with the salience-only framing', () => {
    const out = prompt(['Weimar Cinema'], undefined, {
      birthYear: 1978,
      grewUpCountry: 'United States',
      grewUpRegion: 'Midwest',
    });
    expect(out).toContain('born 1978');
    expect(out).toContain('grew up in Midwest, United States');
    expect(out).toContain('salience only — NEVER difficulty');
    expect(out).toContain('never make a question easier or harder because of it');
  });

  it('renders partial anchors (year-only, place-only) and omits the block entirely when empty/null', () => {
    const yearOnly = prompt(['Weimar Cinema'], undefined, {
      birthYear: 1990,
      grewUpCountry: null,
      grewUpRegion: null,
    });
    expect(yearOnly).toContain('born 1990');
    expect(yearOnly).not.toContain('grew up in');

    const placeOnly = prompt(['Weimar Cinema'], undefined, {
      birthYear: null,
      grewUpCountry: 'Ireland',
      grewUpRegion: null,
    });
    expect(placeOnly).toContain('grew up in Ireland');
    expect(placeOnly).not.toContain('born ');

    for (const anchor of [null, undefined, { birthYear: null, grewUpCountry: null, grewUpRegion: null }]) {
      const out = prompt(['Weimar Cinema'], undefined, anchor);
      expect(out).not.toContain('Player background');
    }
  });
});
