/**
 * Mastery-v2 calibration observability (D-MASTERY-FINEST-NODE-01).
 *
 * A daily, SHADOW-mode picture of what mastery-v2 WOULD show against live data —
 * computed via the pure `resolveV2Mastery`/`rollUpCredit` primitives WITHOUT
 * enabling `KNOWLEDGE_MASTERY_V2` or writing the leaf-freeze ledger. It answers
 * three questions before (and after) you flip the flag:
 *
 *   1. Is mastery even reachable at the current thresholds + supply?
 *   2. If we flip v2 on today, does any live player LOSE a badge they have under
 *      v1? (the user-visible harm — the flip-readiness gate)
 *   3. Which nodes are mis-calibrated, and what threshold would fix them?
 *
 * `computeMasteryCalibration` is pure (unit-tested, no I/O); `buildMasteryCalibration`
 * is the DB wrapper. Nothing here mutates player state — it only reads.
 */

import { desc, eq, gte, sql } from 'drizzle-orm';

import { db, generatedQuestions, masteryCalibrationSnapshot, playerMastery } from '@/server/db';
import { listKnowledgeGraph } from '@/server/db/queries/knowledge-graph';
import { domainKey } from '@/lib/knowledge/domain-key';
import { rollUpCredit, type GraphEdge } from '@/server/knowledge/graph';
import {
  DEFAULT_MASTERY_THRESHOLD,
  MASTERY_FRACTION,
  isMastered,
  masteryProgress,
} from '@/server/knowledge/mastery-v2';
import { isKnowledgeMasteryV2Enabled } from '@/server/knowledge/mastery-v2-resolve';
import { resolveParentMastery, type ParentNodeInput } from '@/server/knowledge/parent-mastery';

// ─── Config (env-tunable) ────────────────────────────────────────────────────

export type CalibConfig = {
  /**
   * Estimated points a single bank question can award a player. Used only for the
   * threshold-vs-supply ESTIMATE (labelled as such in the digest) — real
   * per-answer points vary by state/creator-share, so this is a deliberately
   * coarse proxy, tunable via MASTERY_CALIBRATION_POINTS_PER_QUESTION.
   */
  pointsPerQuestion: number;
  /**
   * A node with fewer than this many bank questions that can't be mastered is a
   * SUPPLY problem (questions not generated yet — by design under the finite-set
   * model), NOT a threshold problem. We don't suggest lowering its threshold.
   */
  minSupplyQuestionsForThresholdSuggestion: number;
  /** Fraction of a node's active players already ≥75% that marks it TOO_EASY. */
  tooEasyPlayerShare: number;
  /** How many worst-calibrated nodes to surface in the digest. */
  worstNodeLimit: number;
};

export const DEFAULT_CALIB_CONFIG: CalibConfig = {
  pointsPerQuestion: 50,
  minSupplyQuestionsForThresholdSuggestion: 3,
  tooEasyPlayerShare: 0.5,
  worstNodeLimit: 15,
};

function calibConfigFromEnv(): CalibConfig {
  const ppq = Number(process.env.MASTERY_CALIBRATION_POINTS_PER_QUESTION);
  return {
    ...DEFAULT_CALIB_CONFIG,
    pointsPerQuestion: Number.isFinite(ppq) && ppq > 0 ? ppq : DEFAULT_CALIB_CONFIG.pointsPerQuestion,
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type CalibNodeInput = {
  domainKey: string;
  label: string;
  nodeKind: 'leaf' | 'parent' | 'both';
  masteryThreshold: number | null;
  broadCategory: string | null;
};

export type CalibUserInput = {
  userId: string;
  /** domainKey → total points (already folded to node keys). */
  pointsByKey: Map<string, number>;
  /** Leaf domainKeys the player holds at tier 'mastery' today (the v1 leaf badge). */
  masteryTierKeys: Set<string>;
};

export type NodeClassification =
  | 'WELL_CALIBRATED'
  | 'TOO_HARD'
  | 'TOO_EASY'
  | 'UNREACHABLE_THRESHOLD'
  | 'UNREACHABLE_SUPPLY';

export type NodeCalib = {
  domainKey: string;
  label: string;
  nodeKind: 'leaf' | 'parent' | 'both';
  broadCategory: string | null;
  threshold: number;
  /** Rolled-up (own + descendant) reachable supply, in ESTIMATED points. */
  estSupplyPoints: number;
  /** Rolled-up (own + descendant) bank-question count. */
  supplyQuestions: number;
  activePlayers: number;
  /** Best player's v2 progress on this node, 0..1. */
  topProgress: number;
  playersAtMastery: number;
  classification: NodeClassification;
  /** A data-anchored threshold suggestion for the misfits; null otherwise. */
  suggestedThreshold: number | null;
};

export type MasteryCalibrationMetrics = {
  /** True when captured WITHOUT the v2 flag live (pure shadow). */
  shadow: boolean;
  totalNodes: number;
  seededNodes: number;
  defaultThresholdNodes: number;
  players: number;
  reachability: {
    pairs: number;
    bucket0_25: number;
    bucket25_50: number;
    bucket50_75: number;
    bucket75plus: number;
  };
  badges: {
    v1Total: number;
    v2Total: number;
    lostByRealPlayers: number;
    gainedByRealPlayers: number;
    playersLosing: number;
    playersGaining: number;
  };
  classificationCounts: Record<NodeClassification, number>;
  worstNodes: NodeCalib[];
  verdict: 'READY' | 'NOT_READY';
  verdictReasons: string[];
  /** Whether the digest is worth emailing (quiet-by-default). */
  actionable: boolean;
  config: CalibConfig;
};

// ─── Pure compute ────────────────────────────────────────────────────────────

function thresholdOf(node: CalibNodeInput): number {
  return node.masteryThreshold != null && node.masteryThreshold > 0
    ? node.masteryThreshold
    : DEFAULT_MASTERY_THRESHOLD;
}

/** Severity for ranking misfits worst-first in the digest. */
function severity(n: NodeCalib): number {
  switch (n.classification) {
    // A wrong bar the player base is actively hitting a wall on is the worst.
    case 'UNREACHABLE_THRESHOLD':
      return 400 + (1 - n.topProgress) * 100;
    case 'TOO_HARD':
      return 300 + (1 - n.topProgress) * 100;
    case 'TOO_EASY':
      return 200 + n.playersAtMastery;
    case 'UNREACHABLE_SUPPLY':
      return 100 + (1 - n.topProgress) * 100;
    case 'WELL_CALIBRATED':
      return 0;
  }
}

export function computeMasteryCalibration(params: {
  nodes: readonly CalibNodeInput[];
  edges: readonly GraphEdge[];
  users: readonly CalibUserInput[];
  /** domainKey → OWN bank-question count (rolled up internally). */
  supplyByKey: ReadonlyMap<string, number>;
  shadow: boolean;
  config?: Partial<CalibConfig>;
}): MasteryCalibrationMetrics {
  const config: CalibConfig = { ...DEFAULT_CALIB_CONFIG, ...params.config };
  const { nodes, edges, users, supplyByKey } = params;

  // Descendant rollups of supply (questions and estimated points).
  const supplyCountsByKey = rollUpCredit(supplyByKey, edges);
  const supplyPointsOwn = new Map<string, number>();
  for (const [key, count] of supplyByKey) supplyPointsOwn.set(key, count * config.pointsPerQuestion);
  const reachablePointsByKey = rollUpCredit(supplyPointsOwn, edges);

  const parents: ParentNodeInput[] = nodes
    .filter((n) => n.nodeKind !== 'leaf')
    .map((n) => ({ domainKey: n.domainKey, masteryThreshold: n.masteryThreshold }));
  const leafKeys = new Set(nodes.filter((n) => n.nodeKind !== 'parent').map((n) => n.domainKey));

  // Per-node accumulators.
  const topProgress = new Map<string, number>();
  const activePlayers = new Map<string, number>();
  const playersAtMastery = new Map<string, number>();

  const reachability = { pairs: 0, bucket0_25: 0, bucket25_50: 0, bucket50_75: 0, bucket75plus: 0 };
  let v1Total = 0;
  let v2Total = 0;
  let lostByRealPlayers = 0;
  let gainedByRealPlayers = 0;
  let playersLosing = 0;
  let playersGaining = 0;

  for (const user of users) {
    const rolled = rollUpCredit(user.pointsByKey, edges);

    // v2 badge set (shadow — no freeze ledger).
    const v2Set = new Set<string>();
    for (const node of nodes) {
      const threshold = thresholdOf(node);
      const points = rolled.get(node.domainKey) ?? 0;
      const prog = masteryProgress(points, threshold);

      if (points > 0) {
        reachability.pairs += 1;
        if (prog >= 0.75) reachability.bucket75plus += 1;
        else if (prog >= 0.5) reachability.bucket50_75 += 1;
        else if (prog >= 0.25) reachability.bucket25_50 += 1;
        else reachability.bucket0_25 += 1;
        activePlayers.set(node.domainKey, (activePlayers.get(node.domainKey) ?? 0) + 1);
        if (prog > (topProgress.get(node.domainKey) ?? 0)) topProgress.set(node.domainKey, prog);
      }
      if (isMastered(points, threshold)) {
        v2Set.add(node.domainKey);
        playersAtMastery.set(node.domainKey, (playersAtMastery.get(node.domainKey) ?? 0) + 1);
      }
    }

    // v1 badge set = frozen/mastered PARENTS (shadow) ∪ LEAF tier-'mastery'.
    const v1Parents = resolveParentMastery(parents, rolled, edges, new Set());
    const v1Set = new Set<string>();
    for (const [key, entry] of v1Parents) if (entry.isMaster) v1Set.add(key);
    for (const key of user.masteryTierKeys) if (leafKeys.has(key)) v1Set.add(key);

    v1Total += v1Set.size;
    v2Total += v2Set.size;
    let lost = 0;
    let gained = 0;
    for (const key of v1Set) if (!v2Set.has(key)) lost += 1;
    for (const key of v2Set) if (!v1Set.has(key)) gained += 1;
    lostByRealPlayers += lost;
    gainedByRealPlayers += gained;
    if (lost > 0) playersLosing += 1;
    if (gained > 0) playersGaining += 1;
  }

  // Per-node classification + suggestions.
  const classificationCounts: Record<NodeClassification, number> = {
    WELL_CALIBRATED: 0,
    TOO_HARD: 0,
    TOO_EASY: 0,
    UNREACHABLE_THRESHOLD: 0,
    UNREACHABLE_SUPPLY: 0,
  };
  let seededNodes = 0;
  const nodeCalibs: NodeCalib[] = [];

  for (const node of nodes) {
    const threshold = thresholdOf(node);
    if (node.masteryThreshold != null && node.masteryThreshold > 0) seededNodes += 1;
    const estSupplyPoints = reachablePointsByKey.get(node.domainKey) ?? 0;
    const supplyQuestions = supplyCountsByKey.get(node.domainKey) ?? 0;
    const active = activePlayers.get(node.domainKey) ?? 0;
    const top = topProgress.get(node.domainKey) ?? 0;
    const atMastery = playersAtMastery.get(node.domainKey) ?? 0;
    // The 75%-of-threshold bar in points, and whether ANY reachable supply clears it.
    const bar = MASTERY_FRACTION * threshold;

    let classification: NodeClassification;
    let suggestedThreshold: number | null = null;

    if (top >= 0.75 && active >= 2 && atMastery / active >= config.tooEasyPlayerShare) {
      classification = 'TOO_EASY';
      // Raise the bar so mastery reflects the seeded topic size; cautious (flag).
      suggestedThreshold = Math.max(threshold + 1, Math.round((top * threshold) * 1.3));
    } else if (bar > estSupplyPoints) {
      // Nobody can EVER cross the bar with the supply that exists.
      if (supplyQuestions < config.minSupplyQuestionsForThresholdSuggestion) {
        classification = 'UNREACHABLE_SUPPLY'; // needs generation, not a lower bar
      } else {
        classification = 'UNREACHABLE_THRESHOLD';
        // Put the 75% bar at ~90% of existing reachable supply → masterable by a
        // strong player without cheapening it. Anchored to SUPPLY, not the (tiny)
        // current player base, to avoid over-fitting to few users.
        suggestedThreshold = Math.max(1, Math.round((estSupplyPoints / MASTERY_FRACTION) * 0.9));
      }
    } else if (top < 0.75) {
      classification = 'TOO_HARD'; // reachable in principle, nobody close
    } else {
      classification = 'WELL_CALIBRATED';
    }
    classificationCounts[classification] += 1;

    nodeCalibs.push({
      domainKey: node.domainKey,
      label: node.label,
      nodeKind: node.nodeKind,
      broadCategory: node.broadCategory,
      threshold,
      estSupplyPoints,
      supplyQuestions,
      activePlayers: active,
      topProgress: top,
      playersAtMastery: atMastery,
      classification,
      suggestedThreshold,
    });
  }

  const worstNodes = nodeCalibs
    .filter((n) => n.classification !== 'WELL_CALIBRATED')
    .sort((a, b) => severity(b) - severity(a))
    .slice(0, config.worstNodeLimit);

  // Flip-readiness: the user-visible harm is a live player LOSING a badge.
  const verdictReasons: string[] = [];
  if (lostByRealPlayers > 0) {
    verdictReasons.push(
      `${lostByRealPlayers} badge(s) across ${playersLosing} player(s) would disappear on flip (had under v1, not under v2).`,
    );
  }
  const unreachableThreshold = classificationCounts.UNREACHABLE_THRESHOLD;
  if (unreachableThreshold > 0) {
    verdictReasons.push(
      `${unreachableThreshold} node(s) are mathematically unmasterable at their current threshold (bar exceeds all reachable supply).`,
    );
  }
  const verdict: 'READY' | 'NOT_READY' = lostByRealPlayers > 0 ? 'NOT_READY' : 'READY';
  if (verdict === 'READY' && verdictReasons.length === 0) {
    verdictReasons.push('No live player loses a badge on flip; no unmasterable-threshold nodes.');
  }

  const actionable = lostByRealPlayers > 0 || unreachableThreshold > 0;

  return {
    shadow: params.shadow,
    totalNodes: nodes.length,
    seededNodes,
    defaultThresholdNodes: nodes.length - seededNodes,
    players: users.length,
    reachability,
    badges: {
      v1Total,
      v2Total,
      lostByRealPlayers,
      gainedByRealPlayers,
      playersLosing,
      playersGaining,
    },
    classificationCounts,
    worstNodes,
    verdict,
    verdictReasons,
    actionable,
    config,
  };
}

// ─── Markdown digest ─────────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : '—';
}

function delta(now: number, prev: number | undefined): string {
  if (prev === undefined) return '';
  const d = now - prev;
  if (d === 0) return ' (±0)';
  return d > 0 ? ` (+${d})` : ` (${d})`;
}

const CLASS_LABEL: Record<NodeClassification, string> = {
  WELL_CALIBRATED: 'well-calibrated',
  TOO_HARD: 'too hard (reachable, nobody close)',
  TOO_EASY: 'too easy (cheap badge)',
  UNREACHABLE_THRESHOLD: 'UNMASTERABLE — threshold too high',
  UNREACHABLE_SUPPLY: 'unmasterable — supply too thin (needs generation)',
};

export function renderMasteryCalibrationMarkdown(
  m: MasteryCalibrationMetrics,
  previous?: MasteryCalibrationMetrics | null,
): string {
  const p = previous ?? null;
  const lines: string[] = [];

  lines.push(`# Mastery-v2 calibration — flip-readiness: ${m.verdict}`);
  lines.push('');
  lines.push(m.shadow ? '_Captured in SHADOW (v2 flag off — this is what v2 WOULD show)._' : '_v2 flag is LIVE._');
  lines.push('');
  for (const reason of m.verdictReasons) lines.push(`- ${reason}`);
  lines.push('');

  lines.push('## Badge divergence (v1 → v2)');
  lines.push(`- Badges shown today (v1): **${m.badges.v1Total}**${delta(m.badges.v1Total, p?.badges.v1Total)}`);
  lines.push(`- Badges under v2: **${m.badges.v2Total}**${delta(m.badges.v2Total, p?.badges.v2Total)}`);
  lines.push(
    `- **Lost on flip: ${m.badges.lostByRealPlayers}** across ${m.badges.playersLosing} player(s) — the user-visible harm.`,
  );
  lines.push(`- Gained on flip: ${m.badges.gainedByRealPlayers} across ${m.badges.playersGaining} player(s).`);
  lines.push('');

  lines.push('## Reachability (player × node pairs with any points)');
  const r = m.reachability;
  lines.push(`- 0–25%: ${r.bucket0_25} (${pct(r.bucket0_25, r.pairs)})`);
  lines.push(`- 25–50%: ${r.bucket25_50} (${pct(r.bucket25_50, r.pairs)})`);
  lines.push(`- 50–75%: ${r.bucket50_75} (${pct(r.bucket50_75, r.pairs)})`);
  lines.push(`- **75%+ (mastered): ${r.bucket75plus} (${pct(r.bucket75plus, r.pairs)})**${delta(r.bucket75plus, p?.reachability.bucket75plus)}`);
  lines.push('');

  lines.push('## Node calibration');
  const c = m.classificationCounts;
  lines.push(`- Well-calibrated: ${c.WELL_CALIBRATED} / ${m.totalNodes}`);
  lines.push(`- Too hard: ${c.TOO_HARD}${delta(c.TOO_HARD, p?.classificationCounts.TOO_HARD)}`);
  lines.push(`- Too easy: ${c.TOO_EASY}${delta(c.TOO_EASY, p?.classificationCounts.TOO_EASY)}`);
  lines.push(
    `- **Unmasterable (threshold): ${c.UNREACHABLE_THRESHOLD}**${delta(c.UNREACHABLE_THRESHOLD, p?.classificationCounts.UNREACHABLE_THRESHOLD)} — lower the bar`,
  );
  lines.push(
    `- Unmasterable (supply): ${c.UNREACHABLE_SUPPLY}${delta(c.UNREACHABLE_SUPPLY, p?.classificationCounts.UNREACHABLE_SUPPLY)} — needs more questions, not a lower bar`,
  );
  lines.push(`- Thresholds: ${m.seededNodes} seeded, ${m.defaultThresholdNodes} on the ${DEFAULT_MASTERY_THRESHOLD}-pt default.`);
  lines.push('');

  if (m.worstNodes.length > 0) {
    lines.push('## Worst-calibrated nodes (suggested recalibration)');
    lines.push('');
    lines.push('| node | kind | issue | threshold | top player | est. supply | suggested |');
    lines.push('|---|---|---|---:|---:|---:|---:|');
    for (const n of m.worstNodes) {
      const suggested = n.suggestedThreshold != null ? `${n.suggestedThreshold}` : '—';
      lines.push(
        `| ${n.label} | ${n.nodeKind} | ${CLASS_LABEL[n.classification]} | ${n.threshold} | ${Math.round(n.topProgress * 100)}% | ~${Math.round(n.estSupplyPoints)}pt (${n.supplyQuestions}q) | ${suggested} |`,
      );
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(
    `_Supply is an ESTIMATE: ${m.config.pointsPerQuestion} pts × non-duplicate bank questions (rolled up the tree). Threshold suggestions are anchored to that supply, not the current player base. Players: ${m.players}, nodes: ${m.totalNodes}._`,
  );

  return lines.join('\n');
}

// ─── DB wrapper ──────────────────────────────────────────────────────────────

export async function buildMasteryCalibration(): Promise<MasteryCalibrationMetrics> {
  const config = calibConfigFromEnv();
  const [graph, masteryRows, supplyRows] = await Promise.all([
    listKnowledgeGraph(),
    db
      .select({
        userId: playerMastery.userId,
        canonicalSubcategory: playerMastery.canonicalSubcategory,
        totalPoints: playerMastery.totalPoints,
        tier: playerMastery.tier,
      })
      .from(playerMastery),
    db
      .select({
        domainKey: generatedQuestions.domainKey,
        count: sql<number>`count(*)::int`,
      })
      .from(generatedQuestions)
      // Non-duplicate bank rows are the reachable pool; null-domain rows group
      // into a null bucket we skip below.
      .where(eq(generatedQuestions.isDuplicate, false))
      .groupBy(generatedQuestions.domainKey),
  ]);

  const nodes: CalibNodeInput[] = graph.nodes.map((n) => ({
    domainKey: n.domainKey,
    label: n.label,
    nodeKind: n.nodeKind,
    masteryThreshold: n.masteryThreshold,
    broadCategory: n.broadCategory,
  }));
  const edges: GraphEdge[] = graph.edges.map((e) => ({
    childDomainKey: e.childDomainKey,
    parentDomainKey: e.parentDomainKey,
  }));

  // Fold player rows into per-user point maps + v1 leaf-mastery sets.
  const userMap = new Map<string, CalibUserInput>();
  for (const row of masteryRows) {
    const key = domainKey(row.canonicalSubcategory);
    let u = userMap.get(row.userId);
    if (!u) {
      u = { userId: row.userId, pointsByKey: new Map(), masteryTierKeys: new Set() };
      userMap.set(row.userId, u);
    }
    u.pointsByKey.set(key, (u.pointsByKey.get(key) ?? 0) + (row.totalPoints ?? 0));
    if (row.tier === 'mastery') u.masteryTierKeys.add(key);
  }

  const supplyByKey = new Map<string, number>();
  for (const row of supplyRows) {
    if (!row.domainKey) continue;
    supplyByKey.set(row.domainKey, (supplyByKey.get(row.domainKey) ?? 0) + (row.count ?? 0));
  }

  return computeMasteryCalibration({
    nodes,
    edges,
    users: [...userMap.values()],
    supplyByKey,
    shadow: !isKnowledgeMasteryV2Enabled(),
    config,
  });
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function writeMasteryCalibrationSnapshot(
  metrics: MasteryCalibrationMetrics,
  markdown: string,
): Promise<void> {
  await db
    .insert(masteryCalibrationSnapshot)
    .values({
      day: utcDay(),
      flagEnabled: !metrics.shadow,
      metrics,
      markdown,
    })
    .onConflictDoUpdate({
      target: masteryCalibrationSnapshot.day,
      set: {
        flagEnabled: !metrics.shadow,
        metrics,
        markdown,
        createdAt: sql`now()`,
      },
    });
}

export type StoredCalibSnapshot = {
  day: string;
  metrics: MasteryCalibrationMetrics;
  markdown: string;
  createdAt: Date;
};

/** The snapshot from ~`daysAgo` days back (nearest on/before), for WoW deltas. */
export async function readCalibSnapshotAround(daysAgo: number): Promise<StoredCalibSnapshot | null> {
  const cutoff = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const [row] = await db
    .select({
      day: masteryCalibrationSnapshot.day,
      metrics: masteryCalibrationSnapshot.metrics,
      markdown: masteryCalibrationSnapshot.markdown,
      createdAt: masteryCalibrationSnapshot.createdAt,
    })
    .from(masteryCalibrationSnapshot)
    .where(gte(masteryCalibrationSnapshot.day, cutoff))
    .orderBy(desc(masteryCalibrationSnapshot.day))
    .limit(1);
  if (!row) return null;
  return {
    day: row.day,
    metrics: row.metrics as MasteryCalibrationMetrics,
    markdown: row.markdown,
    createdAt: row.createdAt,
  };
}
