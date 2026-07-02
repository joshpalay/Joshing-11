import { beforeAll, describe, expect, it } from 'vitest';

// crafter-decisions.ts → @/server/db, which throws at load without a
// connection string; the aggregation under test is pure (repo convention,
// see graph.test.ts).
let mod: typeof import('@/server/db/queries/crafter-decisions');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/db/queries/crafter-decisions');
});

const flag = (kind: string) => ({ kind, note: 'n' });

describe('aggregateGateCalibration', () => {
  it('handles an empty ledger', () => {
    const cal = mod.aggregateGateCalibration([]);
    expect(cal).toEqual({ totalKept: 0, totalKilled: 0, cleanKills: 0, byKind: [] });
  });

  it('splits per-kind into kept-despite vs killed and counts clean kills', () => {
    const cal = mod.aggregateGateCalibration([
      { decision: 'kept', flags: [flag('factual_suspect')] }, // gate overruled
      { decision: 'killed', flags: [flag('factual_suspect')] }, // gate agreed
      { decision: 'killed', flags: [] }, // machine blind spot
      { decision: 'kept', flags: [] },
    ]);
    expect(cal.totalKept).toBe(2);
    expect(cal.totalKilled).toBe(2);
    expect(cal.cleanKills).toBe(1);
    expect(cal.byKind).toEqual([
      { kind: 'factual_suspect', shown: 2, keptDespite: 1, killed: 1 },
    ]);
  });

  it('counts each kind once per verdict even when a card carries duplicate-kind flags', () => {
    const cal = mod.aggregateGateCalibration([
      { decision: 'killed', flags: [flag('quality'), flag('quality')] },
    ]);
    expect(cal.byKind).toEqual([{ kind: 'quality', shown: 1, keptDespite: 0, killed: 1 }]);
  });

  it('sorts kinds by how often they were shown', () => {
    const cal = mod.aggregateGateCalibration([
      { decision: 'kept', flags: [flag('quality')] },
      { decision: 'kept', flags: [flag('tier_mismatch'), flag('quality')] },
      { decision: 'killed', flags: [flag('quality')] },
    ]);
    expect(cal.byKind.map((r) => r.kind)).toEqual(['quality', 'tier_mismatch']);
  });
});
