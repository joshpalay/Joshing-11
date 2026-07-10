import { beforeAll, describe, expect, it } from 'vitest';

// The module imports @/server/db (the DB wrapper), which throws at load without a
// connection string. computeMasteryCalibration is pure; dummy URL + dynamic import
// keeps the unit pure (repo convention, see mastery-v2-resolve.test.ts).
let mod: typeof import('@/server/knowledge/mastery-calibration');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/knowledge/mastery-calibration');
});

type NodeInput = import('@/server/knowledge/mastery-calibration').CalibNodeInput;
type UserInput = import('@/server/knowledge/mastery-calibration').CalibUserInput;
type Edge = import('@/server/knowledge/graph').GraphEdge;

const leaf = (key: string, threshold: number | null): NodeInput => ({
  domainKey: key,
  label: key,
  nodeKind: 'leaf',
  masteryThreshold: threshold,
  broadCategory: null,
});
const parent = (key: string, threshold: number): NodeInput => ({
  domainKey: key,
  label: key,
  nodeKind: 'parent',
  masteryThreshold: threshold,
  broadCategory: null,
});
const edge = (child: string, p: string): Edge => ({ childDomainKey: child, parentDomainKey: p });
const user = (userId: string, points: Record<string, number>, masteryKeys: string[] = []): UserInput => ({
  userId,
  pointsByKey: new Map(Object.entries(points)),
  masteryTierKeys: new Set(masteryKeys),
});

// High supply so nodes aren't flagged unmasterable unless we intend it.
const richSupply = (keys: string[], perKey = 1000) => new Map(keys.map((k) => [k, perKey]));

describe('computeMasteryCalibration — reachability buckets', () => {
  it('buckets each (player, node) pair with points by v2 progress', () => {
    const nodes = [leaf('king lear', 1000)];
    const m = mod.computeMasteryCalibration({
      nodes,
      edges: [],
      users: [
        user('a', { 'king lear': 100 }), // 10% → 0-25
        user('b', { 'king lear': 400 }), // 40% → 25-50
        user('c', { 'king lear': 600 }), // 60% → 50-75
        user('d', { 'king lear': 800 }), // 80% → 75+
      ],
      supplyByKey: richSupply(['king lear']),
      shadow: true,
    });
    expect(m.reachability.pairs).toBe(4);
    expect(m.reachability.bucket0_25).toBe(1);
    expect(m.reachability.bucket25_50).toBe(1);
    expect(m.reachability.bucket50_75).toBe(1);
    expect(m.reachability.bucket75plus).toBe(1);
  });
});

describe('computeMasteryCalibration — badge divergence + flip-readiness', () => {
  it('flags NOT_READY when a v1 leaf-mastery badge is not reproduced under v2', () => {
    // Player has tier-'mastery' on king lear (v1 badge) but only 100 of 1000 pts,
    // so v2 does NOT master it → badge lost on flip.
    const m = mod.computeMasteryCalibration({
      nodes: [leaf('king lear', 1000)],
      edges: [],
      users: [user('a', { 'king lear': 100 }, ['king lear'])],
      supplyByKey: richSupply(['king lear']),
      shadow: true,
    });
    expect(m.badges.v1Total).toBe(1);
    expect(m.badges.v2Total).toBe(0);
    expect(m.badges.lostByRealPlayers).toBe(1);
    expect(m.badges.playersLosing).toBe(1);
    expect(m.verdict).toBe('NOT_READY');
  });

  it('is READY when no live player loses a badge', () => {
    const m = mod.computeMasteryCalibration({
      nodes: [leaf('king lear', 1000)],
      edges: [],
      users: [user('a', { 'king lear': 800 }, ['king lear'])], // 80% → v2 masters it too
      supplyByKey: richSupply(['king lear']),
      shadow: true,
    });
    expect(m.badges.lostByRealPlayers).toBe(0);
    expect(m.verdict).toBe('READY');
  });
});

describe('computeMasteryCalibration — node classification', () => {
  it('UNREACHABLE_THRESHOLD when the 75% bar exceeds reachable supply but questions exist', () => {
    // threshold 100000 → bar 75000 pts; supply 10 questions × 50 = 500 pts. Way short.
    const m = mod.computeMasteryCalibration({
      nodes: [leaf('huge topic', 100000)],
      edges: [],
      users: [user('a', { 'huge topic': 400 })],
      supplyByKey: new Map([['huge topic', 10]]),
      shadow: true,
    });
    const n = m.worstNodes.find((x) => x.domainKey === 'huge topic');
    expect(n?.classification).toBe('UNREACHABLE_THRESHOLD');
    expect(n?.suggestedThreshold).toBeGreaterThan(0);
    expect(m.classificationCounts.UNREACHABLE_THRESHOLD).toBe(1);
  });

  it('UNREACHABLE_SUPPLY (not threshold) when supply is too thin to suggest a bar', () => {
    // Only 1 question → below minSupplyQuestionsForThresholdSuggestion (3): a
    // supply problem, no threshold suggestion.
    const m = mod.computeMasteryCalibration({
      nodes: [leaf('thin niche', 5000)],
      edges: [],
      users: [user('a', { 'thin niche': 20 })],
      supplyByKey: new Map([['thin niche', 1]]),
      shadow: true,
    });
    const n = m.worstNodes.find((x) => x.domainKey === 'thin niche');
    expect(n?.classification).toBe('UNREACHABLE_SUPPLY');
    expect(n?.suggestedThreshold).toBeNull();
  });

  it('TOO_EASY when a majority of active players already sit at mastery', () => {
    const m = mod.computeMasteryCalibration({
      nodes: [leaf('easy topic', 100)],
      edges: [],
      users: [
        user('a', { 'easy topic': 90 }), // 90% mastered
        user('b', { 'easy topic': 95 }), // mastered
      ],
      supplyByKey: richSupply(['easy topic']),
      shadow: true,
      config: { tooEasyPlayerShare: 0.5 },
    });
    const n = m.worstNodes.find((x) => x.domainKey === 'easy topic');
    expect(n?.classification).toBe('TOO_EASY');
    expect(n?.suggestedThreshold).toBeGreaterThan(100);
  });

  it('rolls a parent up from its leaves and classifies it', () => {
    const nodes = [parent('tragedy', 15000), leaf('king lear', 1500), leaf('hamlet', 1500)];
    const edges = [edge('king lear', 'tragedy'), edge('hamlet', 'tragedy')];
    const m = mod.computeMasteryCalibration({
      nodes,
      edges,
      users: [user('a', { 'king lear': 1500, hamlet: 1500 })], // 3000 rolled into tragedy = 20% → not mastered
      supplyByKey: richSupply(['king lear', 'hamlet']),
      shadow: true,
    });
    // Parent supply rolls up from its two leaves.
    const tragedy = [...m.worstNodes, ...[]].find((x) => x.domainKey === 'tragedy');
    // 20% of threshold, reachable in principle (supply high) → TOO_HARD.
    expect(tragedy?.classification).toBe('TOO_HARD');
  });
});
