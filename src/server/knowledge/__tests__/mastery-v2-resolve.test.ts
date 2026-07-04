import { beforeAll, describe, expect, it } from 'vitest';

// resolve imports graph.ts → @/server/db, which throws at load without a
// connection string. The functions never touch the DB; dummy URL + dynamic
// import keeps the unit pure (repo convention, see parent-mastery.test.ts).
let mod: typeof import('@/server/knowledge/mastery-v2-resolve');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/knowledge/mastery-v2-resolve');
});

type Node = import('@/server/knowledge/mastery-v2-resolve').V2Node;
type Edge = import('@/server/knowledge/graph').GraphEdge;

const leaf = (key: string, threshold: number | null): Node => ({ domainKey: key, nodeKind: 'leaf', masteryThreshold: threshold });
const parent = (key: string, threshold: number): Node => ({ domainKey: key, nodeKind: 'parent', masteryThreshold: threshold });
const edge = (child: string, p: string): Edge => ({ childDomainKey: child, parentDomainKey: p });

describe('resolveV2Mastery — leaf grain (points ÷ threshold)', () => {
  it('progress and the 75% master bar', () => {
    const out = mod.resolveV2Mastery(
      [leaf('king lear', 1500), leaf('hamlet', 1500)],
      [],
      new Map([['king lear', 1200], ['hamlet', 1000]]),
    );
    expect(out.get('king lear')).toMatchObject({ points: 1200, progress: 0.8, isMaster: true }); // 1200 ≥ 1125
    expect(out.get('hamlet')).toMatchObject({ isMaster: false }); // 1000 < 1125
  });

  it('a frozen leaf reads master even with no points', () => {
    const out = mod.resolveV2Mastery([leaf('macbeth', 1000)], [], new Map(), new Set(['macbeth']));
    expect(out.get('macbeth')).toMatchObject({ points: 0, progress: 0, isMaster: true });
  });

  it('falls back to the default threshold for an unseeded (null) node', () => {
    const out = mod.resolveV2Mastery([leaf('fresh', null)], [], new Map());
    expect(out.get('fresh')?.threshold).toBe(mod.DEFAULT_MASTERY_THRESHOLD ?? 1000);
  });
});

describe('resolveV2Mastery — parent grain (rolled-up points ÷ own independent threshold)', () => {
  const NODES = [
    parent('shakespearean tragedy', 15000), // whole-area threshold — big, independent
    leaf('king lear', 1500),
    leaf('hamlet', 1500),
    leaf('macbeth', 1000),
  ];
  const EDGES = [
    edge('king lear', 'shakespearean tragedy'),
    edge('hamlet', 'shakespearean tragedy'),
    edge('macbeth', 'shakespearean tragedy'),
  ];

  it('an INCOMPLETE area is not masterable — even fully covering its current leaves', () => {
    const out = mod.resolveV2Mastery(
      NODES,
      EDGES,
      new Map([['king lear', 1500], ['hamlet', 1500], ['macbeth', 1000]]), // all three maxed
    );
    // rolled-up 4000 / 15000 = 0.267 — the area's threshold expects far more leaves.
    expect(out.get('shakespearean tragedy')).toMatchObject({ points: 4000, isMaster: false });
    expect(out.get('shakespearean tragedy')!.progress).toBeCloseTo(4000 / 15000);
  });

  it('mastering one leaf does NOT master the parent (King Lear ≠ all of Tragedy)', () => {
    const out = mod.resolveV2Mastery(NODES, EDGES, new Map([['king lear', 1500]]));
    expect(out.get('king lear')?.isMaster).toBe(true); // the leaf is mastered…
    expect(out.get('shakespearean tragedy')?.isMaster).toBe(false); // …the area is not
  });

  it('a parent masters once its rolled-up points cross 75% of ITS threshold', () => {
    const out = mod.resolveV2Mastery(
      [parent('lear cycle', 2000), leaf('king lear', 1500)],
      [edge('king lear', 'lear cycle')],
      new Map([['king lear', 1600]]),
    );
    expect(out.get('lear cycle')).toMatchObject({ points: 1600, isMaster: true }); // 1600 ≥ 1500
  });

  it('points roll up transitively through nested parents', () => {
    const out = mod.resolveV2Mastery(
      [parent('tragedy', 5000), parent('lear cycle', 2000), leaf('king lear', 1500)],
      [edge('lear cycle', 'tragedy'), edge('king lear', 'lear cycle')],
      new Map([['king lear', 500]]),
    );
    expect(out.get('tragedy')?.points).toBe(500);
    expect(out.get('lear cycle')?.points).toBe(500);
  });

  it("a 'both' node bears its own points and masters on them", () => {
    const nodes: Node[] = [
      { domainKey: 'bach', nodeKind: 'both', masteryThreshold: 1000 },
      leaf('well-tempered clavier', 800),
    ];
    const out = mod.resolveV2Mastery(nodes, [edge('well-tempered clavier', 'bach')], new Map([['bach', 800]]));
    expect(out.get('bach')).toMatchObject({ points: 800, isMaster: true }); // 800 ≥ 750
  });
});
