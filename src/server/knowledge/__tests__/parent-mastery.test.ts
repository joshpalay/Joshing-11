import { beforeAll, describe, expect, it } from 'vitest';

// Pure resolution only — the DB wrapper is a thin flag-gated shell. Dummy URL +
// dynamic import per repo convention.
let mastery: typeof import('@/server/knowledge/parent-mastery');
let graph: typeof import('@/server/knowledge/graph');
let tree: typeof import('@/server/knowledge/knowledge-tree');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mastery = await import('@/server/knowledge/parent-mastery');
  graph = await import('@/server/knowledge/graph');
  tree = await import('@/server/knowledge/knowledge-tree');
});

type Edge = import('@/server/knowledge/graph').GraphEdge;
const sub = (child: string, parent: string): Edge => ({
  childDomainKey: child,
  parentDomainKey: parent,
  edgeType: 'substantive',
});

const PARENT = { domainKey: 'renaissance italy', masteryThreshold: 2000 };

describe('resolveParentMastery — §B freeze semantics', () => {
  it('the §5 non-revocation guarantee, as a test: roster growth cannot drop a frozen master', () => {
    // Yesterday: 2 corners, 2100 points — crossed and frozen.
    // Today: a third leaf was authored AND the threshold was raised to 5000.
    const grownEdges = [
      sub('medici family', 'renaissance italy'),
      sub('machiavelli', 'renaissance italy'),
      sub('venetian trade', 'renaissance italy'), // new unlit corner
    ];
    const totals = graph.rollUpCredit(
      new Map([
        ['medici family', 1200],
        ['machiavelli', 900],
      ]),
      grownEdges,
    );
    const resolved = mastery.resolveParentMastery(
      [{ domainKey: 'renaissance italy', masteryThreshold: 5000 }], // bar raised past earned credit
      totals,
      grownEdges,
      new Set(['renaissance italy']), // the frozen row
    );
    const entry = resolved.get('renaissance italy')!;
    expect(entry.isMaster).toBe(true); // still master — frozen wins before recompute
    expect(entry.frozen).toBe(true);
    expect(entry.pct).toBe(1); // fraction frozen
  });

  it('a NON-master fraction DOES update on roster growth (live until crossed)', () => {
    const before = graph.rosterCoverage(
      'renaissance italy',
      graph.rollUpCredit(new Map([['medici family', 500]]), [sub('medici family', 'renaissance italy')]),
      [sub('medici family', 'renaissance italy')],
    );
    expect(before).toEqual({ lit: 1, total: 1 });

    const grownEdges = [
      sub('medici family', 'renaissance italy'),
      sub('machiavelli', 'renaissance italy'),
    ];
    const after = graph.rosterCoverage(
      'renaissance italy',
      graph.rollUpCredit(new Map([['medici family', 500]]), grownEdges),
      grownEdges,
    );
    expect(after).toEqual({ lit: 1, total: 2 }); // 1/1 → 1/2, honest — the field grew
  });

  it('unfrozen parents resolve by the live bar + corner gate', () => {
    const edges = [sub('medici family', 'renaissance italy'), sub('machiavelli', 'renaissance italy')];
    const totals = graph.rollUpCredit(
      new Map([
        ['medici family', 1200],
        ['machiavelli', 900],
      ]),
      edges,
    );
    const resolved = mastery.resolveParentMastery([PARENT], totals, edges, new Set());
    expect(resolved.get('renaissance italy')!.isMaster).toBe(true);
    expect(resolved.get('renaissance italy')!.frozen).toBe(false);
  });
});

describe('buildKnowledgeTree with the freeze param — leaf mastery untouched', () => {
  const NODES = [
    { domainKey: 'renaissance italy', label: 'Renaissance Italy', nodeKind: 'parent' as const, masteryThreshold: 2000, fieldHue: 'history', broadCategory: 'History' },
    { domainKey: 'medici family', label: 'Medici Family', nodeKind: 'leaf' as const, masteryThreshold: null, fieldHue: 'history', broadCategory: 'History' },
  ];
  const EDGES = [sub('medici family', 'renaissance italy')];
  const OWNED = [{ domain: 'Medici Family', points: 500, mastered: true, broadCategory: 'History' }];

  const findNode = (
    n: import('@/server/knowledge/knowledge-tree').KnowledgeTreeNode,
    id: string,
  ): import('@/server/knowledge/knowledge-tree').KnowledgeTreeNode | null => {
    if (n.id === id) return n;
    for (const c of n.children ?? []) {
      const hit = findNode(c, id);
      if (hit) return hit;
    }
    return null;
  };

  it('leaf mastery output is identical with the freeze param on or off', () => {
    const off = tree.buildKnowledgeTree(OWNED, NODES, EDGES);
    const on = tree.buildKnowledgeTree(OWNED, NODES, EDGES, new Set(['renaissance italy']));
    expect(findNode(off, 'medici family')?.mastered).toBe(true);
    expect(findNode(on, 'medici family')?.mastered).toBe(true); // leaf-exact either way
  });

  it('a frozen parent renders mastered even below the live bar', () => {
    const off = tree.buildKnowledgeTree(OWNED, NODES, EDGES);
    expect(findNode(off, 'renaissance italy')?.mastered).toBeUndefined(); // 500/2000, 1 corner
    const on = tree.buildKnowledgeTree(OWNED, NODES, EDGES, new Set(['renaissance italy']));
    expect(findNode(on, 'renaissance italy')?.mastered).toBe(true); // frozen wins
  });
});
