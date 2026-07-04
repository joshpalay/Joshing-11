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

const leaf = (key: string, weight: number | null): Node => ({ domainKey: key, nodeKind: 'leaf', nodeWeight: weight });
const parent = (key: string): Node => ({ domainKey: key, nodeKind: 'parent', nodeWeight: null });
const edge = (child: string, p: string): Edge => ({ childDomainKey: child, parentDomainKey: p });

// Deterministic bars: weight × 100.
const OPTS = { pointsPerWeight: 100 } as const;

describe('resolveV2Mastery — leaf grain', () => {
  it('bars scale with weight; progress is the clamped fraction', () => {
    const { leaves } = mod.resolveV2Mastery(
      [leaf('king lear', 8), leaf('hamlet', 6)],
      [],
      new Map([['king lear', 800], ['hamlet', 300]]),
      new Set(),
      OPTS,
    );
    expect(leaves.get('king lear')).toMatchObject({ leafBar: 800, progress: 1, isMaster: true });
    expect(leaves.get('hamlet')).toMatchObject({ leafBar: 600, progress: 0.5, isMaster: false });
  });

  it('a frozen leaf reads master even with no points', () => {
    const { leaves } = mod.resolveV2Mastery(
      [leaf('macbeth', 4)],
      [],
      new Map(),
      new Set(['macbeth']),
      OPTS,
    );
    expect(leaves.get('macbeth')).toMatchObject({ progress: 0, isMaster: true });
  });

  it('caps the bar at reachable supply so a deep-but-thin leaf stays masterable', () => {
    const { leaves } = mod.resolveV2Mastery(
      [leaf('spy school', 8)], // weight → bar 800…
      [],
      new Map([['spy school', 300]]),
      new Set(),
      { ...OPTS, reachableSupplyByKey: new Map([['spy school', 300]]) }, // …capped to 300
    );
    expect(leaves.get('spy school')).toMatchObject({ leafBar: 300, isMaster: true });
  });

  it('falls back to DEFAULT_NODE_WEIGHT for an unseeded (null) node', () => {
    const { leaves } = mod.resolveV2Mastery([leaf('fresh', null)], [], new Map(), new Set(), OPTS);
    expect(leaves.get('fresh')?.leafBar).toBe(mod.DEFAULT_NODE_WEIGHT * 100);
  });
});

describe('resolveV2Mastery — parent grain (live coverage)', () => {
  const NODES = [parent('shakespearean tragedy'), leaf('king lear', 8), leaf('hamlet', 6), leaf('macbeth', 4)];
  const EDGES = [
    edge('king lear', 'shakespearean tragedy'),
    edge('hamlet', 'shakespearean tragedy'),
    edge('macbeth', 'shakespearean tragedy'),
  ];

  it('mastering one leaf does NOT master the parent (King Lear ≠ all of Tragedy)', () => {
    const { parents } = mod.resolveV2Mastery(NODES, EDGES, new Map([['king lear', 800]]), new Set(), OPTS);
    // 8 / (8+6+4) = 0.444
    expect(parents.get('shakespearean tragedy')?.coverage).toBeCloseTo(8 / 18);
    expect(parents.get('shakespearean tragedy')?.isMaster).toBe(false);
  });

  it('the fragments RECOMBINE: enough covered leaves cross the 75% bar', () => {
    const { parents } = mod.resolveV2Mastery(
      NODES,
      EDGES,
      new Map([['king lear', 800], ['hamlet', 600]]), // both mastered
      new Set(),
      OPTS,
    );
    expect(parents.get('shakespearean tragedy')?.coverage).toBeCloseTo(14 / 18); // 0.778
    expect(parents.get('shakespearean tragedy')?.isMaster).toBe(true);
  });

  it('a frozen descendant leaf contributes in full', () => {
    const { parents } = mod.resolveV2Mastery(
      NODES,
      EDGES,
      new Map([['king lear', 800]]),
      new Set(['hamlet']), // frozen, 0 points, still full contribution
      OPTS,
    );
    expect(parents.get('shakespearean tragedy')?.coverage).toBeCloseTo(14 / 18);
  });

  it('coverage rolls up transitively through nested parents', () => {
    // tragedy → (lear-cycle parent) → king lear leaf
    const nodes = [parent('tragedy'), parent('lear cycle'), leaf('king lear', 5)];
    const edges = [edge('lear cycle', 'tragedy'), edge('king lear', 'lear cycle')];
    const { parents } = mod.resolveV2Mastery(nodes, edges, new Map([['king lear', 500]]), new Set(), OPTS);
    expect(parents.get('tragedy')?.coverage).toBe(1); // the only descendant leaf is mastered
    expect(parents.get('lear cycle')?.coverage).toBe(1);
  });

  it("a 'both' node appears in BOTH grains", () => {
    const nodes: Node[] = [
      { domainKey: 'bach', nodeKind: 'both', nodeWeight: 5 },
      leaf('well-tempered clavier', 4),
    ];
    const edges = [edge('well-tempered clavier', 'bach')];
    const { leaves, parents } = mod.resolveV2Mastery(nodes, edges, new Map([['bach', 500]]), new Set(), OPTS);
    expect(leaves.get('bach')?.isMaster).toBe(true); // own points 500 ≥ bar 500
    expect(parents.has('bach')).toBe(true); // also a container
  });
});
