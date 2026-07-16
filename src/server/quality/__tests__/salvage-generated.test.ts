import { beforeAll, afterEach, describe, expect, it } from 'vitest';

import type { SalvageProposal } from '@/server/quality/salvage-question';

// Same pure-import guard as verify-question.test.ts: the module pulls in
// @/server/db (throws without a connection string), but the functions under test
// never touch the DB. Dummy URL + dynamic import keeps the unit pure.
let mod: typeof import('@/server/quality/salvage-generated');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/quality/salvage-generated');
});

const stemFix: SalvageProposal = {
  kind: 'extra_fact_stem',
  proposedStem: 'fixed stem',
  proposedExplanation: null,
  note: 'removed bad year',
};
const explainerFix: SalvageProposal = {
  kind: 'extra_fact_explainer',
  proposedStem: null,
  proposedExplanation: 'fixed explainer',
  note: 'corrected distillery name',
};
const unsalvageable: SalvageProposal = {
  kind: 'unsalvageable',
  proposedStem: null,
  proposedExplanation: null,
  note: 'answer itself is wrong',
};

describe('decideGeneratedSalvage — apply only a re-verified concrete fix', () => {
  it('applies a stem fix that re-verified ok', () => {
    const d = mod.decideGeneratedSalvage(stemFix, 'ok');
    expect(d).toEqual({ apply: true, proposedStem: 'fixed stem', proposedExplanation: null });
  });

  it('applies an explainer fix that re-verified ok', () => {
    const d = mod.decideGeneratedSalvage(explainerFix, 'ok');
    expect(d.apply).toBe(true);
  });

  it('suppresses when the proposal is unsalvageable (even if reverify says ok)', () => {
    expect(mod.decideGeneratedSalvage(unsalvageable, 'ok')).toEqual({ apply: false });
  });

  it('suppresses when the re-verified fix still does not pass', () => {
    for (const outcome of ['demoted', 'unverifiable', null] as const) {
      expect(mod.decideGeneratedSalvage(stemFix, outcome)).toEqual({ apply: false });
    }
  });

  it('suppresses a proposal that carries no actual replacement text', () => {
    const empty: SalvageProposal = { kind: 'extra_fact_stem', proposedStem: null, proposedExplanation: null, note: 'x' };
    expect(mod.decideGeneratedSalvage(empty, 'ok')).toEqual({ apply: false });
  });
});

describe('isSalvageGeneratedOnDemoteEnabled — default ON, off only when explicitly disabled', () => {
  const KEY = 'SALVAGE_GENERATED_ON_DEMOTE_ENABLED';
  afterEach(() => {
    delete process.env[KEY];
  });

  it('defaults ON when unset', () => {
    expect(mod.isSalvageGeneratedOnDemoteEnabled()).toBe(true);
  });

  it('is OFF for false/0/no/off, ON otherwise', () => {
    for (const v of ['false', '0', 'no', 'off', 'FALSE', ' Off ']) {
      process.env[KEY] = v;
      expect(mod.isSalvageGeneratedOnDemoteEnabled()).toBe(false);
    }
    for (const v of ['true', '1', 'yes', 'anything']) {
      process.env[KEY] = v;
      expect(mod.isSalvageGeneratedOnDemoteEnabled()).toBe(true);
    }
  });
});
