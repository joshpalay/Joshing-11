/**
 * Mastery v2 (docs/thinking/MASTERY-MODEL-v2.md) — Phase 5: the pure READ-MODEL.
 *
 * Composes node WEIGHT (Phase 2, `node_weight`) and the v2 KERNEL (Phase 1,
 * mastery-v2.ts) over the containment tree (Phase 4, every edge is depth-eligible)
 * into per-node mastery, split by grain (spec decision 3):
 *
 *   - LEAF grain (freeze-able): every point-bearing node (nodeKind leaf | both).
 *     leafBar = f(weight, reachable supply); progress = points/bar; mastered when
 *     frozen OR points ≥ bar. Once a leaf is frozen it reads as master forever.
 *   - PARENT grain (LIVE coverage): a container's depth-weighted coverage of its
 *     descendant point-bearing leaves. Mastered at ≥ 75% (PARENT_MASTERY_COVERAGE).
 *     Never frozen — it rises and falls as the map grows (this is what recombines
 *     the fine sub-domains a question-domain recompute fragments; see the Phase 3
 *     finding in the spec).
 *
 * Pure and deterministic — no DB, no writes. The DB-backed wrapper (reading the
 * leaf-freeze ledger, loading nodes/edges/points) and the surface wiring
 * (buildKnowledgeTree behind KNOWLEDGE_MASTERY_V2) land in the follow-up P5 step.
 */

import { eq } from 'drizzle-orm';

import { db, knowledgeLeafMastery } from '@/server/db';
import { substantiveDescendants, type GraphEdge } from '@/server/knowledge/graph';
import {
  computeLeafBar,
  leafMastered,
  leafProgress,
  parentCoverage,
  type LeafContribution,
} from '@/server/knowledge/mastery-v2';

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/** Flag gate for the v2 read path (the follow-up surface wiring reads this). */
export function isKnowledgeMasteryV2Enabled(): boolean {
  return boolEnv('KNOWLEDGE_GRAPH_ENABLED', false) && boolEnv('KNOWLEDGE_MASTERY_V2', false);
}

/**
 * Fallback weight for an unseeded node. Every prod node was seeded 2026-07-04, but
 * a node minted after the backfill (before its seed runs) reads null — treat it as
 * mid-weight rather than skew coverage.
 */
export const DEFAULT_NODE_WEIGHT = 3;

export type V2Node = {
  domainKey: string;
  nodeKind: 'leaf' | 'parent' | 'both';
  nodeWeight: number | null;
};

export type LeafMastery = {
  domainKey: string;
  leafBar: number;
  /** 0..1 fraction of the bar earned. */
  progress: number;
  /** frozen (permanent) OR points ≥ bar. */
  isMaster: boolean;
};

export type ParentMastery = {
  domainKey: string;
  /** 0..1 depth-weighted coverage of descendant leaves. */
  coverage: number;
  /** coverage ≥ PARENT_MASTERY_COVERAGE. Live — never frozen. */
  isMaster: boolean;
};

export type V2MasteryResult = {
  leaves: Map<string, LeafMastery>;
  parents: Map<string, ParentMastery>;
};

export type ResolveV2Options = {
  /** Override the weight→points mapping (mastery-v2 DEFAULT_POINTS_PER_WEIGHT otherwise). */
  pointsPerWeight?: number;
  /** Per-leaf cap: the points the domain's existing questions can actually award. */
  reachableSupplyByKey?: ReadonlyMap<string, number>;
};

/**
 * Resolve v2 mastery for a set of authored nodes + containment edges + a player's
 * per-leaf points. `frozenLeaves` are leaves the player has permanently mastered
 * (the leaf-freeze ledger, read by the DB wrapper). Pure — inject everything.
 */
export function resolveV2Mastery(
  nodes: readonly V2Node[],
  edges: readonly GraphEdge[],
  pointsByKey: ReadonlyMap<string, number>,
  frozenLeaves: ReadonlySet<string> = new Set(),
  options: ResolveV2Options = {},
): V2MasteryResult {
  const nodeByKey = new Map(nodes.map((n) => [n.domainKey, n]));
  const weightOf = (n: V2Node): number =>
    n.nodeWeight != null && n.nodeWeight > 0 ? n.nodeWeight : DEFAULT_NODE_WEIGHT;

  // 1) LEAF grain — every point-bearing node (leaf or 'both').
  const leaves = new Map<string, LeafMastery>();
  for (const node of nodes) {
    if (node.nodeKind === 'parent') continue; // pure container, no own points
    const leafBar = computeLeafBar({
      weight: weightOf(node),
      reachableSupplyPoints: options.reachableSupplyByKey?.get(node.domainKey),
      pointsPerWeight: options.pointsPerWeight,
    });
    const points = pointsByKey.get(node.domainKey) ?? 0;
    leaves.set(node.domainKey, {
      domainKey: node.domainKey,
      leafBar,
      progress: leafProgress(points, leafBar),
      isMaster: frozenLeaves.has(node.domainKey) || leafMastered(points, leafBar),
    });
  }

  // 2) PARENT grain — LIVE depth-weighted coverage of descendant leaves.
  const parents = new Map<string, ParentMastery>();
  for (const node of nodes) {
    if (node.nodeKind === 'leaf') continue; // not a container
    const contributions: LeafContribution[] = [];
    for (const descendantKey of substantiveDescendants(node.domainKey, edges)) {
      const leaf = leaves.get(descendantKey);
      if (!leaf) continue; // descendant is a pure parent — no own weight/points
      const descendantNode = nodeByKey.get(descendantKey);
      contributions.push({
        weight: descendantNode ? weightOf(descendantNode) : DEFAULT_NODE_WEIGHT,
        // A mastered/frozen leaf contributes in full; else its partial progress.
        progress: leaf.isMaster ? 1 : leaf.progress,
      });
    }
    const { coverage, isMaster } = parentCoverage(contributions);
    parents.set(node.domainKey, { domainKey: node.domainKey, coverage, isMaster });
  }

  return { leaves, parents };
}

// ─── DB-backed wrapper (mirrors parent-mastery.ts's getParentMasteryForUser) ───

export async function getFrozenLeafKeys(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ leafDomainKey: knowledgeLeafMastery.leafDomainKey })
    .from(knowledgeLeafMastery)
    .where(eq(knowledgeLeafMastery.userId, userId));
  return new Set(rows.map((r) => r.leafDomainKey));
}

// Idempotent stamp — the unique (user, leaf) index makes a re-master a no-op.
export async function freezeLeafMastery(userId: string, leafKey: string): Promise<void> {
  await db
    .insert(knowledgeLeafMastery)
    .values({ userId, leafDomainKey: leafKey })
    .onConflictDoNothing();
}

/**
 * DB-backed resolve: reads the leaf-freeze ledger, resolves v2 mastery, and stamps
 * any freshly-mastered leaf so it becomes terminal. Flag-off returns pure
 * computation with an empty frozen set and never writes — so this is inert until
 * KNOWLEDGE_MASTERY_V2 flips.
 */
export async function getV2MasteryForUser(
  userId: string,
  nodes: readonly V2Node[],
  edges: readonly GraphEdge[],
  pointsByKey: ReadonlyMap<string, number>,
  options: ResolveV2Options = {},
): Promise<V2MasteryResult> {
  const enabled = isKnowledgeMasteryV2Enabled();
  const frozen = enabled ? await getFrozenLeafKeys(userId) : new Set<string>();
  const result = resolveV2Mastery(nodes, edges, pointsByKey, frozen, options);

  if (enabled) {
    for (const [key, leaf] of result.leaves) {
      if (leaf.isMaster && !frozen.has(key)) {
        await freezeLeafMastery(userId, key); // best-effort terminal stamp
      }
    }
  }
  return result;
}
