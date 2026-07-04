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

  it('includeGhosts:false (friend variant) renders only held territory — no invitations', () => {
    const tree = mod.buildKnowledgeTree(OWNED, NODES, EDGES, new Set(), { includeGhosts: false });
    const parent = findNode(tree, 'renaissance italy');
    expect((parent!.children ?? []).some((c) => c.ghost)).toBe(false);
    expect(findNode(tree, 'machiavelli')).toBeNull();
    expect(mod.sumRealPoints(tree)).toBe(500); // real totals identical either way
  });

  // D-KNOWLEDGE-MAP-USABILITY-01 C3 — the gap-view framing on parents.
  it('parents carry progress: roll-up points, threshold, corners, roster coverage', () => {
    const tree = mod.buildKnowledgeTree(OWNED, NODES, EDGES);
    const parent = findNode(tree, 'renaissance italy');
    expect(parent?.progress).toEqual({
      points: 500, // Medici roll-up (§5.1 full value)
      threshold: 2000, // the human-set bar
      corners: 1, // one lit corner
      rosterCovered: 1,
      rosterSize: 3, // Medici + Machiavelli + Venetian Trade
    });
    // Leaves never carry progress — the trophy is the leaf, not a fraction.
    expect(findNode(tree, 'medici family')?.progress).toBeUndefined();
  });

  it('an unauthored broad category maps to a stable non-gray hue', () => {
    const first = mod.hueForBroadCategory('Religion & Mythology');
    expect(first).not.toBeNull(); // no gray fallback for a real category
    expect(mod.hueForBroadCategory('Religion & Mythology')).toBe(first); // stable
    expect(mod.hueForBroadCategory(null)).toBeNull(); // absence still means no hue
  });
});

describe('grow-rim — unheld same-field roots as ghost invitations', () => {
  const nodesWithRim = [
    ...NODES,
    node('Tudor England', 'parent', 1500), // unheld root, same 'history' hue
    node('Baroque Opera', 'parent', 1500), // unheld root, DIFFERENT field
  ];
  // Baroque Opera gets a music hue — the rim only invites into fields you
  // already inhabit.
  nodesWithRim[nodesWithRim.length - 1] = {
    ...nodesWithRim[nodesWithRim.length - 1],
    fieldHue: 'music',
  };

  it('shows unheld roots sharing a held field, as ghosts, and skips other fields', () => {
    const tree = mod.buildKnowledgeTree(OWNED, nodesWithRim, EDGES);
    const tudor = findNode(tree, 'tudor england');
    expect(tudor?.ghost).toBe(true);
    expect(tudor?.value).toBe(mod.GHOST_FOOTPRINT);
    expect(findNode(tree, 'baroque opera')).toBeNull(); // music not inhabited
  });

  it('the rim is capped and never inflates totals', () => {
    const many = [
      ...NODES,
      ...Array.from({ length: 6 }, (_, i) => node(`History Field ${i}`, 'parent', 1000)),
    ];
    const tree = mod.buildKnowledgeTree(OWNED, many, EDGES);
    const rimGhosts = (tree.children ?? []).filter((c) => c.ghost);
    expect(rimGhosts.length).toBeLessThanOrEqual(mod.GROW_RIM_CAP);
    expect(mod.sumRealPoints(tree)).toBe(500);
  });

  it('friend variant has no rim', () => {
    const tree = mod.buildKnowledgeTree(OWNED, nodesWithRim, EDGES, new Set(), {
      includeGhosts: false,
    });
    expect(findNode(tree, 'tudor england')).toBeNull();
  });
});

// collectCollections tests removed 2026-07-04 (migration 0110): the collection
// edge type and the coverage strip are gone.
