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
