/**
 * Mastery v2 (docs/thinking/MASTERY-MODEL-v2.md "Final model") — the READ-MODEL.
 *
 * Projects a player's per-leaf points onto the containment tree and resolves each
 * node's mastery against its own POINTS threshold:
 *   points   = rolled-up points (a leaf's own; a parent's descendant sum)
 *   progress = points / threshold
 *   mastered = points ≥ 75% of threshold        (isMastered)
 * One formula for every node. The only leaf/parent difference:
 *   - LEAF (and 'both') mastery FREEZES — permanent once earned (the freeze
 *     ledger); a pure PARENT is LIVE (climbs/falls as the map fills in).
 *   - Parent thresholds are INDEPENDENT (the LLM's estimate of the whole area),
 *     not a sum of leaves — so an incomplete area can't be falsely mastered.
 *
 * The pure `resolveV2Mastery` is unit-tested without a DB; `getV2MasteryForUser`
 * is the thin DB wrapper (reads/stamps the leaf-freeze ledger). Inert until
 * KNOWLEDGE_MASTERY_V2 flips.
 */

import { eq } from 'drizzle-orm';

import { db, knowledgeLeafMastery } from '@/server/db';
import { rollUpCredit, type GraphEdge } from '@/server/knowledge/graph';
import {
  DEFAULT_MASTERY_THRESHOLD,
  isMastered,
  masteryProgress,
} from '@/server/knowledge/mastery-v2';

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/** Flag gate for the v2 read path. */
export function isKnowledgeMasteryV2Enabled(): boolean {
  return boolEnv('KNOWLEDGE_GRAPH_ENABLED', false) && boolEnv('KNOWLEDGE_MASTERY_V2', false);
}

export type V2Node = {
  domainKey: string;
  nodeKind: 'leaf' | 'parent' | 'both';
  /** The node's mastery threshold in POINTS (null → the code default). */
  masteryThreshold: number | null;
};

export type V2NodeMastery = {
  domainKey: string;
  /** The points threshold in effect (seeded value or the default). */
  threshold: number;
  /** Rolled-up points (own for a leaf; descendant sum for a parent). */
  points: number;
  /** 0..1 fraction of the threshold earned. */
  progress: number;
  /** points ≥ 75% of threshold, OR (leaf/both only) a frozen master. */
  isMaster: boolean;
};

function thresholdOf(node: V2Node): number {
  return node.masteryThreshold != null && node.masteryThreshold > 0
    ? node.masteryThreshold
    : DEFAULT_MASTERY_THRESHOLD;
}

/** A node bears its own points (and its mastery freezes) unless it's a pure parent. */
function freezeEligible(node: V2Node): boolean {
  return node.nodeKind !== 'parent';
}

/**
 * Resolve v2 mastery for the authored nodes + containment edges + a player's
 * per-leaf points. `frozenLeaves` are leaves permanently mastered (the freeze
 * ledger). Pure — one entry per node, same formula throughout.
 */
export function resolveV2Mastery(
  nodes: readonly V2Node[],
  edges: readonly GraphEdge[],
  pointsByKey: ReadonlyMap<string, number>,
  frozenLeaves: ReadonlySet<string> = new Set(),
): Map<string, V2NodeMastery> {
  // Every node's rolled-up points: a leaf's own, a parent's descendant sum.
  const totals = rollUpCredit(pointsByKey, edges);

  const out = new Map<string, V2NodeMastery>();
  for (const node of nodes) {
    const threshold = thresholdOf(node);
    const points = totals.get(node.domainKey) ?? 0;
    const frozen = freezeEligible(node) && frozenLeaves.has(node.domainKey);
    out.set(node.domainKey, {
      domainKey: node.domainKey,
      threshold,
      points,
      progress: masteryProgress(points, threshold),
      isMaster: frozen || isMastered(points, threshold),
    });
  }
  return out;
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
 * DB-backed resolve: reads the leaf-freeze ledger, resolves, and stamps any
 * freshly-mastered LEAF/'both' node so it becomes terminal. Flag-off returns pure
 * computation with an empty frozen set and never writes — inert until the flag.
 */
export async function getV2MasteryForUser(
  userId: string,
  nodes: readonly V2Node[],
  edges: readonly GraphEdge[],
  pointsByKey: ReadonlyMap<string, number>,
): Promise<Map<string, V2NodeMastery>> {
  const enabled = isKnowledgeMasteryV2Enabled();
  const frozen = enabled ? await getFrozenLeafKeys(userId) : new Set<string>();
  const result = resolveV2Mastery(nodes, edges, pointsByKey, frozen);

  if (enabled) {
    for (const node of nodes) {
      if (!freezeEligible(node)) continue; // only leaf/'both' mastery freezes
      const entry = result.get(node.domainKey);
      if (entry?.isMaster && !frozen.has(node.domainKey)) {
        await freezeLeafMastery(userId, node.domainKey); // best-effort terminal stamp
      }
    }
  }
  return result;
}
