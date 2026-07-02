import { beforeAll, describe, expect, it } from 'vitest';

// knowledge-tree.ts → @/server/db (via loaders); dummy URL + dynamic import
// keeps the pure functions testable (repo convention).
let mod: typeof import('@/server/knowledge/knowledge-tree');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/knowledge/knowledge-tree');
});

type Node = import('@/server/knowledge/knowledge-tree').AuthoredNode;
type Edge = import('@/server/knowledge/graph').GraphEdge;

const node = (label: string, kind: Node['nodeKind'] = 'leaf', threshold: number | null = null): Node => ({
  domainKey: label.toLowerCase(),
  label,
  nodeKind: kind,
  masteryThreshold: threshold,
  fieldHue: 'history',
  broadCategory: 'History',
});
const sub = (child: string, parent: string): Edge => ({
  childDomainKey: child.toLowerCase(),
  parentDomainKey: parent.toLowerCase(),
  edgeType: 'substantive',
});

const NODES: Node[] = [
  node('Renaissance Italy', 'parent', 2000),
  node('Medici Family'),
  node('Machiavelli'),
  node('Venetian Trade'),
];
const EDGES: Edge[] = [
  sub('Medici Family', 'Renaissance Italy'),
  sub('Machiavelli', 'Renaissance Italy'),
  sub('Venetian Trade', 'Renaissance Italy'),
];

const OWNED = [
  { domain: 'Medici Family', points: 500, mastered: true, broadCategory: 'History' },
];

function findNode(
  tree: import('@/server/knowledge/knowledge-tree').KnowledgeTreeNode,
  id: string,
): import('@/server/knowledge/knowledge-tree').KnowledgeTreeNode | null {
  if (tree.id === id) return tree;
  for (const child of tree.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

describe('buildKnowledgeTree', () => {
  it('ghosts never inflate totals — parent real points = sum of non-ghost descendants', () => {
    const tree = mod.buildKnowledgeTree(OWNED, NODES, EDGES);
    const parent = findNode(tree, 'renaissance italy');
    expect(parent).not.toBeNull();
    // Ghost siblings render (unheld roster corners)…
    const ghosts = (parent!.children ?? []).filter((c) => c.ghost);
    expect(ghosts.map((g) => g.id).sort()).toEqual(['machiavelli', 'venetian trade']);
    // …but the subtree's REAL points are exactly the owned leaf's.
    expect(mod.sumRealPoints(parent!)).toBe(500);
  });

  it('adding then removing a ghost leaves real totals unchanged', () => {
    const withGhosts = mod.buildKnowledgeTree(OWNED, NODES, EDGES);
    const withoutGhostNodes = mod.buildKnowledgeTree(
      OWNED,
      NODES.filter((n) => n.domainKey === 'renaissance italy' || n.domainKey === 'medici family'),
      EDGES.filter((e) => e.childDomainKey === 'medici family'),
    );
    expect(mod.sumRealPoints(withGhosts)).toBe(mod.sumRealPoints(withoutGhostNodes));
    expect(mod.sumRealPoints(withGhosts)).toBe(500);
  });

  it('leaf mastery is leaf-exact; the parent is not mastered off one corner', () => {
    const tree = mod.buildKnowledgeTree(OWNED, NODES, EDGES);
    expect(findNode(tree, 'medici family')?.mastered).toBe(true);
    expect(findNode(tree, 'renaissance italy')?.mastered).toBeUndefined();
  });

  it('a parent crosses only with threshold AND ≥2 corners', () => {
    const spread = [
      { domain: 'Medici Family', points: 1200, mastered: true, broadCategory: 'History' },
      { domain: 'Machiavelli', points: 900, mastered: false, broadCategory: 'History' },
    ];
    const tree = mod.buildKnowledgeTree(spread, NODES, EDGES);
    expect(findNode(tree, 'renaissance italy')?.mastered).toBe(true);
  });

  it('multi-parent leaves render once, under the home parent (§E)', () => {
    const nodes = [...NODES, node('Florentine Politics', 'parent', 1000)];
    const edges = [...EDGES, sub('Medici Family', 'Florentine Politics')];
    const tree = mod.buildKnowledgeTree(OWNED, nodes, edges);
    let count = 0;
    const walk = (n: import('@/server/knowledge/knowledge-tree').KnowledgeTreeNode) => {
      if (n.id === 'medici family') count += 1;
      n.children?.forEach(walk);
    };
    walk(tree);
    expect(count).toBe(1); // home parent only — first substantive edge
  });

  it('owned leaves the graph does not know land under the root', () => {
    const tree = mod.buildKnowledgeTree(
      [...OWNED, { domain: 'Star Trek', points: 280, mastered: false, broadCategory: 'Film & TV' }],
      NODES,
      EDGES,
    );
    const trek = (tree.children ?? []).find((c) => c.name === 'Star Trek');
    expect(trek).toBeDefined();
    expect(trek?.value).toBe(280);
    expect(trek?.field).toBe('film-tv'); // broad-category → --cat-* hue mapping
  });

  it('ghost footprints carry value for layout but sumRealPoints excludes them', () => {
    const tree = mod.buildKnowledgeTree(OWNED, NODES, EDGES);
    const ghost = findNode(tree, 'machiavelli');
    expect(ghost?.ghost).toBe(true);
    expect(ghost?.value).toBe(mod.GHOST_FOOTPRINT);
    expect(mod.sumRealPoints(ghost!)).toBe(0);
  });
});
