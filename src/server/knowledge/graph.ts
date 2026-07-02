/**
 * B-KNOWLEDGE-TAXONOMY-01 P2 — the knowledge graph's read model + roll-up.
 * (D-KNOWLEDGE-TAXONOMY-MODEL-01; §5.1/§9-A as REVISED: points-are-points.)
 *
 * DARK: nothing under src/app or src/components imports this module yet — the
 * query layer reads the 0102 tables and the credit math is pure functions,
 * wired to surfaces only when the KNOWLEDGE_GRAPH_* flags flip (P4–P6).
 *
 * Credit semantics (§5.1, supersedes the earlier fractional/CAP idea):
 *   - A question's points credit its finest node AND every substantive
 *     ancestor at FULL value. No diminishment; a diamond (two paths to the
 *     same ancestor) still credits that ancestor ONCE — points represent the
 *     same knowledge, not the number of routes it travelled.
 *   - Collection edges never carry points (§7) — they light coverage slots.
 *   - Parent mastery = points ≥ the human-set absolute threshold AND ≥2
 *     substantive corners lit (§9-A). The threshold is a long bar; the corner
 *     gate is what makes all-Hamlet ≠ master of Shakespearean Tragedy.
 *   - Leaf mastery is leaf-exact and never recomputed by anything here (§3).
 */

import { eq } from 'drizzle-orm';

import { db, knowledgeEdges, knowledgeNodes } from '@/server/db';

export type KnowledgeNodeRow = typeof knowledgeNodes.$inferSelect;
export type KnowledgeEdgeRow = typeof knowledgeEdges.$inferSelect;

export type GraphEdge = {
  childDomainKey: string;
  parentDomainKey: string;
  edgeType: 'substantive' | 'collection';
};

// Human-set absolute thresholds are the rule (§5); this default only covers a
// pure parent whose threshold the author left null. Deliberately high — an
// unconfigured parent should under-promise, never hand out cheap mastery.
export const DEFAULT_PARENT_MASTERY_THRESHOLD = 1000;

// §9-A: substantive-parent mastery needs breadth — at least this many direct
// substantive children with any credit. Points alone can never cross.
export const MIN_CORNERS_FOR_PARENT_MASTERY = 2;

// ─── query layer (0102 tables) ───────────────────────────────────────────────

export async function getNode(domainKeyValue: string): Promise<KnowledgeNodeRow | null> {
  const [row] = await db
    .select()
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.domainKey, domainKeyValue))
    .limit(1);
  return row ?? null;
}

// A parent's roster: its direct child edges (the human-authored corner list, §B).
export async function getRoster(parentKey: string): Promise<KnowledgeEdgeRow[]> {
  return db.select().from(knowledgeEdges).where(eq(knowledgeEdges.parentDomainKey, parentKey));
}

// A child's upward memberships, edge types included (§7 — a leaf may have many
// parents, and the type decides how credit accrues).
export async function getParents(childKey: string): Promise<KnowledgeEdgeRow[]> {
  return db.select().from(knowledgeEdges).where(eq(knowledgeEdges.childDomainKey, childKey));
}

// ─── pure credit math (no DB — unit-tested with D-doc §2 fixtures) ───────────

/**
 * All substantive ancestors of a node (transitive, cycle-safe, excludes the
 * node itself). Collection edges are not walked — they never carry points.
 */
export function substantiveAncestors(nodeKey: string, edges: readonly GraphEdge[]): Set<string> {
  const parentsByChild = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.edgeType !== 'substantive') continue;
    const list = parentsByChild.get(edge.childDomainKey);
    if (list) list.push(edge.parentDomainKey);
    else parentsByChild.set(edge.childDomainKey, [edge.parentDomainKey]);
  }

  const ancestors = new Set<string>();
  const queue = [...(parentsByChild.get(nodeKey) ?? [])];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (next === nodeKey || ancestors.has(next)) continue; // cycle/diamond guard
    ancestors.add(next);
    queue.push(...(parentsByChild.get(next) ?? []));
  }
  return ancestors;
}

/**
 * Total points per node: its own direct credits + full-value roll-up from
 * every descendant reachable by substantive edges (§5.1 — points are points).
 * Diamond-safe: each credited node adds its points to each ancestor exactly
 * once, however many paths connect them.
 */
export function rollUpCredit(
  leafCredits: ReadonlyMap<string, number>,
  edges: readonly GraphEdge[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [nodeKey, points] of leafCredits) {
    if (!(points > 0)) continue;
    totals.set(nodeKey, (totals.get(nodeKey) ?? 0) + points);
    for (const ancestor of substantiveAncestors(nodeKey, edges)) {
      totals.set(ancestor, (totals.get(ancestor) ?? 0) + points);
    }
  }
  return totals;
}

/**
 * How many of a parent's direct substantive corners are lit — a corner is a
 * direct substantive child whose subtree holds ANY credit (its total from
 * rollUpCredit is positive).
 */
export function litCorners(
  parentKey: string,
  totals: ReadonlyMap<string, number>,
  edges: readonly GraphEdge[],
): number {
  let lit = 0;
  for (const edge of edges) {
    if (edge.parentDomainKey !== parentKey || edge.edgeType !== 'substantive') continue;
    if ((totals.get(edge.childDomainKey) ?? 0) > 0) lit += 1;
  }
  return lit;
}

export type ParentProgress = {
  /** Honest fraction of the bar — uncapped movement, clamped to 1 for display. */
  pct: number;
  isMaster: boolean;
};

/**
 * §9-A (revised): progress = full rolled-up points / the absolute threshold —
 * honest movement, no fractional cap. Mastery needs BOTH the bar and breadth:
 * points ≥ threshold AND ≥2 corners. All-Hamlet with points over the bar and
 * one corner is NOT a master of the parent.
 */
export function parentProgress(
  rolledPoints: number,
  corners: number,
  threshold: number | null,
): ParentProgress {
  const bar = threshold ?? DEFAULT_PARENT_MASTERY_THRESHOLD;
  const isMaster = rolledPoints >= bar && corners >= MIN_CORNERS_FOR_PARENT_MASTERY;
  return { pct: bar > 0 ? Math.min(rolledPoints / bar, 1) : 0, isMaster };
}

export type CollectionCoverage = {
  covered: number;
  rosterSize: number;
  pct: number;
};

/**
 * Collection parents are pure coverage (§7/§9-A): each distinct member with
 * any credit lights one slot; depth within a member never over-credits. No
 * threshold or corner logic applies.
 */
export function collectionCoverage(membersCovered: number, rosterSize: number): CollectionCoverage {
  return {
    covered: membersCovered,
    rosterSize,
    pct: rosterSize > 0 ? Math.min(membersCovered / rosterSize, 1) : 0,
  };
}

/**
 * Coverage counter for a collection parent from raw totals: distinct direct
 * collection members with any credit (depth in one member still lights ONE slot).
 */
export function collectionMembersCovered(
  parentKey: string,
  totals: ReadonlyMap<string, number>,
  edges: readonly GraphEdge[],
): number {
  let covered = 0;
  for (const edge of edges) {
    if (edge.parentDomainKey !== parentKey || edge.edgeType !== 'collection') continue;
    if ((totals.get(edge.childDomainKey) ?? 0) > 0) covered += 1;
  }
  return covered;
}
