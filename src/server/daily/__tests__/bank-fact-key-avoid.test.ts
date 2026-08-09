import { beforeAll, describe, expect, it } from 'vitest';

// generate-questions.ts imports @/server/db, which throws at module load without
// a connection string. mergeFactKeyAvoid is pure; a dummy URL plus dynamic import
// (the repo convention) keeps the unit pure.
let mergeFactKeyAvoid: typeof import('@/server/daily/generate-questions').mergeFactKeyAvoid;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ mergeFactKeyAvoid } = await import('@/server/daily/generate-questions'));
});

const entries = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ domain: 'D', factKey: `${prefix}-${i}` }));

// Bank-wide fact novelty (2026-08-07). The per-user avoid list could not see that
// a fact was already banked from another player's round, so the shared bank
// accumulated redundant stock (717 of 2,553 rows; 492 still servable). Feeding
// bank keys to the PROMPT is what saves the spend — dropping at persist time
// happens after the tokens are already paid for.
describe('mergeFactKeyAvoid', () => {
  const PROMPT_LIMIT = 200;
  const RESERVE = 60;
  const rendered = (out: { factKey: string }[]) => out.slice(0, PROMPT_LIMIT).map((e) => e.factKey);

  it('keeps bank keys inside the prompt window when viewer history overflows it', () => {
    // THE BUG THIS PINS: with a naive [...viewer, ...bank] append, a player with a
    // full history pushes every bank key past the prompt's slice — so the feature
    // is silently inert for exactly the users whose domains are deepest.
    const out = mergeFactKeyAvoid(entries('viewer', 500), entries('bank', 100), PROMPT_LIMIT, RESERVE);
    const inPrompt = rendered(out);
    expect(inPrompt.filter((k) => k.startsWith('bank')).length).toBe(RESERVE);
    expect(inPrompt.filter((k) => k.startsWith('viewer')).length).toBe(PROMPT_LIMIT - RESERVE);
  });

  it('adds no prompt tokens — the rendered block still holds exactly promptLimit entries', () => {
    const before = entries('viewer', 500).slice(0, PROMPT_LIMIT);
    const after = rendered(mergeFactKeyAvoid(entries('viewer', 500), entries('bank', 100), PROMPT_LIMIT, RESERVE));
    expect(after.length).toBe(before.length);
  });

  it('never drops a viewer key from the full result, so the persist guard is unweakened', () => {
    const viewer = entries('viewer', 500);
    const out = mergeFactKeyAvoid(viewer, entries('bank', 100), PROMPT_LIMIT, RESERVE);
    const keys = new Set(out.map((e) => e.factKey));
    for (const v of viewer) expect(keys.has(v.factKey)).toBe(true);
  });

  it('does not spend the bank reserve on facts already in the viewer history', () => {
    // The viewer's own key is the stronger constraint and is rendered regardless;
    // duplicating it would waste a reserved slot.
    const shared = [{ domain: 'D', factKey: 'shared' }];
    const out = mergeFactKeyAvoid(shared, [...shared, { domain: 'D', factKey: 'fresh' }], PROMPT_LIMIT, RESERVE);
    expect(out.map((e) => e.factKey)).toEqual(['shared', 'fresh']);
  });

  it('includes everything when both lists fit under the cap', () => {
    const out = mergeFactKeyAvoid(entries('viewer', 5), entries('bank', 5), PROMPT_LIMIT, RESERVE);
    expect(out).toHaveLength(10);
  });

  it('is a viewer-only pass-through when there is no bank stock', () => {
    const viewer = entries('viewer', 300);
    expect(mergeFactKeyAvoid(viewer, [], PROMPT_LIMIT, RESERVE)).toEqual(viewer);
  });

  it('clamps a reserve larger than the whole prompt budget', () => {
    // reserve clamps to the budget (10), so the rendered window is all bank keys
    // and the viewer's are pushed past it — still present for the avoid set.
    const out = mergeFactKeyAvoid(entries('viewer', 50), entries('bank', 50), 10, 999);
    expect(out.slice(0, 10).every((e) => e.factKey.startsWith('bank'))).toBe(true);
    // 10 bank (the clamped reserve) + all 50 viewer keys. Bank keys beyond the
    // reserve are intentionally not carried: the reserve bounds this path's bank
    // exposure, and getServableBankFactKeys already caps its own read per domain.
    expect(out).toHaveLength(60);
    expect(out.filter((e) => e.factKey.startsWith('viewer'))).toHaveLength(50);
  });
});
