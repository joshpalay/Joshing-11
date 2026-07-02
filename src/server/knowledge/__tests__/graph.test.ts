import { beforeAll, describe, expect, it } from 'vitest';

// graph.ts → @/server/db, which throws at load without a connection string.
// The pure functions never touch the DB; dummy URL + dynamic import keeps the
// unit pure (repo convention, see verify-question.test.ts).
let mod: typeof import('@/server/knowledge/graph');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/knowledge/graph');
});

type Edge = import('@/server/knowledge/graph').GraphEdge;

const sub = (child: string, parent: string): Edge => ({
  childDomainKey: child,
  parentDomainKey: parent,
  edgeType: 'substantive',
});
const col = (child: string, parent: string): Edge => ({
  childDomainKey: child,
  parentDomainKey: parent,
  edgeType: 'collection',
});

// D-doc §2 world: Renaissance Italy's roster.
const RENAISSANCE_EDGES: Edge[] = [
  sub('medici family', 'renaissance italy'),
  sub('machiavelli', 'renaissance italy'),
  sub('florentine art', 'renaissance italy'),
  sub('the papacy', 'renaissance italy'),
  sub('venetian trade', 'renaissance italy'),
];

describe('rollUpCredit — §5.1 points are points', () => {
  it('credits every substantive ancestor at FULL value (no diminishment)', () => {
    const totals = mod.rollUpCredit(new Map([['medici family', 500]]), RENAISSANCE_EDGES);
    expect(totals.get('medici family')).toBe(500);
    expect(totals.get('renaissance italy')).toBe(500); // full value, not a fraction
  });

  it('walks multi-level chains and stays cycle-safe', () => {
    const edges: Edge[] = [
      sub('wtc', 'bach'),
      sub('bach', 'classical music'),
      // pathological cycle — must not hang or double-count
      sub('classical music', 'wtc'),
    ];
    const totals = mod.rollUpCredit(new Map([['wtc', 120]]), edges);
    expect(totals.get('wtc')).toBe(120);
    expect(totals.get('bach')).toBe(120);
    expect(totals.get('classical music')).toBe(120);
  });

  it('a diamond credits the shared grandparent ONCE, not per path', () => {
    const edges: Edge[] = [
      sub('hamlet', 'tragedies'),
      sub('hamlet', 'elizabethan drama'),
      sub('tragedies', 'shakespeare'),
      sub('elizabethan drama', 'shakespeare'),
    ];
    const totals = mod.rollUpCredit(new Map([['hamlet', 300]]), edges);
    expect(totals.get('tragedies')).toBe(300); // full credit to EACH parent (§E)
    expect(totals.get('elizabethan drama')).toBe(300);
    expect(totals.get('shakespeare')).toBe(300); // once — not 600
  });

  it('collection edges never carry points', () => {
    const edges: Edge[] = [col('hamlet', 'plays starting with h')];
    const totals = mod.rollUpCredit(new Map([['hamlet', 2500]]), edges);
    expect(totals.get('plays starting with h')).toBeUndefined();
  });
});

describe('parentProgress — §9-A revised (threshold bar + ≥2-corner gate)', () => {
  it('Josh all-Medici: honest 500/2000 movement, NOT capped, NOT master', () => {
    const totals = mod.rollUpCredit(new Map([['medici family', 500]]), RENAISSANCE_EDGES);
    const corners = mod.litCorners('renaissance italy', totals, RENAISSANCE_EDGES);
    expect(corners).toBe(1);
    const progress = mod.parentProgress(totals.get('renaissance italy') ?? 0, corners, 2000);
    expect(progress.pct).toBeCloseTo(0.25); // honest movement — the old ~60% CAP is gone
    expect(progress.isMaster).toBe(false);
  });

  it('the all-Hamlet gate: points OVER the bar with one corner is NOT master', () => {
    const edges: Edge[] = [sub('hamlet', 'tragedies'), sub('macbeth', 'tragedies')];
    const totals = mod.rollUpCredit(new Map([['hamlet', 2500]]), edges);
    const corners = mod.litCorners('tragedies', totals, edges);
    expect(corners).toBe(1);
    const progress = mod.parentProgress(totals.get('tragedies') ?? 0, corners, 2000);
    expect(progress.pct).toBe(1); // display-clamped at the bar
    expect(progress.isMaster).toBe(false); // breadth gate holds
  });

  it('Jaime spread: crosses the bar with ≥2 corners → master', () => {
    const totals = mod.rollUpCredit(
      new Map([
        ['medici family', 800],
        ['machiavelli', 700],
        ['the papacy', 600],
      ]),
      RENAISSANCE_EDGES,
    );
    const corners = mod.litCorners('renaissance italy', totals, RENAISSANCE_EDGES);
    expect(corners).toBe(3);
    const progress = mod.parentProgress(totals.get('renaissance italy') ?? 0, corners, 2000);
    expect(progress.isMaster).toBe(true);
  });

  it('leaf mastery is untouched by parent math — leaf totals stay leaf-exact', () => {
    const totals = mod.rollUpCredit(
      new Map([
        ['medici family', 500],
        ['machiavelli', 9000],
      ]),
      RENAISSANCE_EDGES,
    );
    expect(totals.get('medici family')).toBe(500); // sibling depth never dilutes it (§3)
  });

  it('null threshold falls back to the deliberately-high default', () => {
    const progress = mod.parentProgress(mod.DEFAULT_PARENT_MASTERY_THRESHOLD, 2, null);
    expect(progress.isMaster).toBe(true);
    expect(mod.parentProgress(mod.DEFAULT_PARENT_MASTERY_THRESHOLD - 1, 2, null).isMaster).toBe(false);
  });
});

describe('resolveFinestNode — P3 tagging (flag-gated, fail-open, no minting)', () => {
  const NODE = {
    id: 'n1',
    label: 'Renaissance Florence',
    domainKey: 'renaissance florence',
    nodeKind: 'leaf' as const,
    masteryThreshold: null,
    broadCategory: null,
    fieldHue: null,
    createdAt: new Date(),
  };

  const flagsOn = () => {
    process.env.KNOWLEDGE_GRAPH_ENABLED = 'true';
    process.env.KNOWLEDGE_GRAPH_TAGGING = 'true';
  };
  const flagsOff = () => {
    delete process.env.KNOWLEDGE_GRAPH_ENABLED;
    delete process.env.KNOWLEDGE_GRAPH_TAGGING;
  };

  it('flag-off (default): returns the label unchanged and never looks up', async () => {
    flagsOff();
    let lookups = 0;
    const out = await mod.resolveFinestNode('Renaissance – Florence', {
      lookup: async () => {
        lookups += 1;
        return NODE;
      },
    });
    expect(out).toBe('Renaissance – Florence'); // byte-identical
    expect(lookups).toBe(0);
  });

  it('flag-on: a label folding onto an existing node tags to that node', async () => {
    flagsOn();
    try {
      // en-dash variant folds to the same domainKey as the node
      const out = await mod.resolveFinestNode('Renaissance – Florence', {
        lookup: async (key) => (key === 'renaissance florence' ? NODE : null),
      });
      expect(out).toBe('Renaissance Florence');
    } finally {
      flagsOff();
    }
  });

  it('flag-on, no node: label persists as today — never mints a node', async () => {
    flagsOn();
    try {
      const out = await mod.resolveFinestNode('NBA Playoffs', { lookup: async () => null });
      expect(out).toBe('NBA Playoffs');
    } finally {
      flagsOff();
    }
  });

  it('fail-open: a lookup fault returns the label unchanged (writes never break)', async () => {
    flagsOn();
    try {
      const out = await mod.resolveFinestNode('Tennis', {
        lookup: async () => {
          throw new Error('db down');
        },
      });
      expect(out).toBe('Tennis');
    } finally {
      flagsOff();
    }
  });

  it('the master flag alone is not enough — both flags must be on', async () => {
    process.env.KNOWLEDGE_GRAPH_ENABLED = 'true';
    delete process.env.KNOWLEDGE_GRAPH_TAGGING;
    try {
      let lookups = 0;
      const out = await mod.resolveFinestNode('Renaissance – Florence', {
        lookup: async () => {
          lookups += 1;
          return NODE;
        },
      });
      expect(out).toBe('Renaissance – Florence');
      expect(lookups).toBe(0);
    } finally {
      flagsOff();
    }
  });
});

describe('buildClusterMatcher — P6 Beat 4 cluster overlap (the Josh/Ari fix)', () => {
  const CTX = {
    nodeKeys: new Set(['medici family', 'renaissance florence', 'renaissance italy']),
    labelByKey: new Map([
      ['medici family', 'Medici Family'],
      ['renaissance florence', 'Renaissance Florence'],
      ['renaissance italy', 'Renaissance Italy'],
    ]),
    edges: [
      { childDomainKey: 'medici family', parentDomainKey: 'renaissance italy', edgeType: 'substantive' as const },
      { childDomainKey: 'renaissance florence', parentDomainKey: 'renaissance italy', edgeType: 'substantive' as const },
    ],
  };

  it('flag-on semantics: same-cluster different-string domains align under the shared label', () => {
    // Josh holds "Renaissance Florence"; Ari holds "Medici Family" — different
    // strings, same authored territory via the common parent.
    const match = mod.buildClusterMatcher(['Renaissance Florence'], CTX);
    expect(match('Medici Family')).toBe('Renaissance Italy'); // the shared cluster's label
    expect(match('NBA Playoffs')).toBeNull(); // unrelated stays unrelated
  });

  it('flag-off semantics: the same pair is UNALIGNED under exact-string matching', () => {
    const viewerDomains = new Set(['Renaissance Florence']);
    expect(viewerDomains.has('Medici Family')).toBe(false); // today's behavior, preserved off-flag
  });

  it('exact same string still aligns, graph or no graph', () => {
    const match = mod.buildClusterMatcher(['Renaissance Florence'], CTX);
    expect(match('Renaissance – Florence')).toBe('Renaissance Florence'); // typographic variant folds
    const noGraph = mod.buildClusterMatcher(['Tennis'], { nodeKeys: new Set(), labelByKey: new Map(), edges: [] });
    expect(noGraph('Tennis')).toBe('Tennis');
    expect(noGraph('Chess')).toBeNull();
  });

  it('collection edges never create alignment', () => {
    const ctx = {
      nodeKeys: new Set(['hamlet', 'plays starting with h', 'henry v']),
      labelByKey: new Map([['plays starting with h', 'Plays Starting With H']]),
      edges: [
        { childDomainKey: 'hamlet', parentDomainKey: 'plays starting with h', edgeType: 'collection' as const },
        { childDomainKey: 'henry v', parentDomainKey: 'plays starting with h', edgeType: 'collection' as const },
      ],
    };
    const match = mod.buildClusterMatcher(['Hamlet'], ctx);
    expect(match('Henry V')).toBeNull(); // knowing Hamlet says nothing about Henry V (§7)
  });
});

describe('collectionCoverage — §7 coverage-only', () => {
  const H_SHELF: Edge[] = [
    col('hamlet', 'plays starting with h'),
    col('henry v', 'plays starting with h'),
    col('hedda gabler', 'plays starting with h'),
  ];

  it('depth in one member lights exactly one slot', () => {
    const totals = mod.rollUpCredit(new Map([['hamlet', 2500]]), H_SHELF);
    // collection totals don't roll — coverage counts credited members directly
    const covered = mod.collectionMembersCovered(
      'plays starting with h',
      new Map([['hamlet', 2500]]),
      H_SHELF,
    );
    expect(covered).toBe(1);
    expect(mod.collectionCoverage(covered, 3).pct).toBeCloseTo(1 / 3);
    expect(totals.get('plays starting with h')).toBeUndefined();
  });

  it('covering all members completes the set', () => {
    const credits = new Map([
      ['hamlet', 10],
      ['henry v', 10],
      ['hedda gabler', 10],
    ]);
    const covered = mod.collectionMembersCovered('plays starting with h', credits, H_SHELF);
    expect(mod.collectionCoverage(covered, 3).pct).toBe(1);
  });

  it('empty roster yields zero, not NaN', () => {
    expect(mod.collectionCoverage(0, 0).pct).toBe(0);
  });
});

describe('substantiveDescendants — B-SUPPLY-GRAPH-DEPTH-01 (supply depth walk)', () => {
  it('walks transitively downward and excludes the node itself', () => {
    const edges = [
      ...RENAISSANCE_EDGES,
      sub('cosimo de medici', 'medici family'),
    ];
    const descendants = mod.substantiveDescendants('renaissance italy', edges);
    expect(descendants.has('medici family')).toBe(true);
    expect(descendants.has('cosimo de medici')).toBe(true); // grandchild
    expect(descendants.has('renaissance italy')).toBe(false);
    expect(descendants.size).toBe(6);
  });

  it('never walks collection edges (members are coverage, not depth)', () => {
    const edges = [sub('medici family', 'renaissance italy'), col('mona lisa', 'renaissance italy')];
    const descendants = mod.substantiveDescendants('renaissance italy', edges);
    expect(descendants.has('mona lisa')).toBe(false);
    expect(descendants.size).toBe(1);
  });

  it('is cycle-safe and diamond-safe', () => {
    const cyclic = [sub('a', 'b'), sub('b', 'a'), sub('c', 'a'), sub('c', 'b')];
    expect([...mod.substantiveDescendants('a', cyclic)].sort()).toEqual(['b', 'c']);
  });

  it('a leaf has no descendants', () => {
    expect(mod.substantiveDescendants('medici family', RENAISSANCE_EDGES).size).toBe(0);
  });

  it('is the exact inverse of substantiveAncestors', () => {
    const edges = [...RENAISSANCE_EDGES, sub('cosimo de medici', 'medici family')];
    for (const node of ['cosimo de medici', 'medici family', 'machiavelli']) {
      for (const ancestor of mod.substantiveAncestors(node, edges)) {
        expect(mod.substantiveDescendants(ancestor, edges).has(node)).toBe(true);
      }
    }
  });
});
