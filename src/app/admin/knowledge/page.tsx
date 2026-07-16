import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import {
  getCorpusLabelDepths,
  getCorpusLabelGenStats,
  getCorpusLabelPoints,
} from '@/server/db/queries/crafter-demand';
import { listKnowledgeGraph } from '@/server/db/queries/knowledge-graph';
import { getRetrievalConfig } from '@/server/daily/retrieval-config';
import { buildSupplyCoverageSummary } from '@/server/daily/supply-coverage';
import { domainKey } from '@/lib/knowledge/domain-key';

import { KnowledgeAdminClient, type SupplyReadout } from './KnowledgeAdminClient';

export const dynamic = 'force-dynamic';

// B-KNOWLEDGE-ADMIN-01 P1 — the human-authoring surface for the knowledge
// graph (D-doc §4). Structure only: nodes, edges, thresholds, edge types.
// Same gate contract as every admin page: ADMIN_USER_IDS or Next's 404 —
// the route's existence is not revealed.
export default async function AdminKnowledgePage() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  const [{ nodes, edges }, corpusDepths, corpusPoints, corpusGenStats, supply] = await Promise.all([
    listKnowledgeGraph(),
    // Per-label question depth (machine + human), so the tree can flag
    // territories too thin to stand alone ("this is too small — condense it").
    getCorpusLabelDepths(),
    // Per-label points currently available (difficulty-weighted), shown next to
    // Qs so a curator can eyeball it against the node's mastery threshold.
    getCorpusLabelPoints(),
    // Per-label generation exhaustion (total produced + duplicates), so the tree
    // can flag where NEW questions are hard to find (high duplicate share).
    getCorpusLabelGenStats(),
    // The supply lens over the SAME areas ("knowledge graph and domain supply
    // should have the same information") — per-row readout + a link to the
    // supply table. Fail-open internally: null just means no chips this load.
    buildSupplyCoverageSummary(),
  ]);
  const ownDepthByKey: Record<string, number> = {};
  const ownMachineDepthByKey: Record<string, number> = {};
  for (const entry of corpusDepths) {
    const key = domainKey(entry.label);
    ownDepthByKey[key] = (ownDepthByKey[key] ?? 0) + entry.machineDepth + entry.humanAuthored;
    ownMachineDepthByKey[key] = (ownMachineDepthByKey[key] ?? 0) + entry.machineDepth;
  }
  const ownPointsByKey: Record<string, number> = {};
  for (const entry of corpusPoints) {
    ownPointsByKey[domainKey(entry.label)] = (ownPointsByKey[domainKey(entry.label)] ?? 0) + entry.points;
  }
  const ownGenByKey: Record<string, { total: number; dupes: number }> = {};
  for (const entry of corpusGenStats) {
    const key = domainKey(entry.label);
    const acc = (ownGenByKey[key] ??= { total: 0, dupes: 0 });
    acc.total += entry.total;
    acc.dupes += entry.dupes;
  }

  // Rolled-up Qs for display: questions are filed under LEAF labels, so a
  // parent's own count is ~0 — its meaningful "questions in this area" is the
  // sum over its subtree. Leaves have no children, so their rolled value
  // equals their own count (the thin-leaf check downstream stays correct).
  const childrenByParent = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenByParent.get(edge.parentDomainKey);
    if (list) list.push(edge.childDomainKey);
    else childrenByParent.set(edge.parentDomainKey, [edge.childDomainKey]);
  }
  // "Exhausted" = tapped out at the narrow-KB / area-expansion gate boundary
  // (kb-exhaustion.ts fires below `poolDepthThreshold` servable facts, where the
  // system stops serving fresh Qs and pushes expansion). Named to match the
  // codebase's existing term for this concept (kb-exhaustion) — distinct from the
  // supply-*ceiling*/"capped" expansion trigger (a player topping the difficulty
  // ladder). To mean genuinely exhausted, not merely under-generated, a leaf must
  // (a) have been mined (generated ≥ threshold times), (b) still hold fewer than
  // threshold servable machine facts, AND (c) show generation hitting a wall —
  // mostly duplicates, or producing nothing servable. A big topic with a low dup
  // rate stays "needs generation".
  const POOL_THRESHOLD = getRetrievalConfig().poolDepthThreshold;
  const EXHAUSTED_DUP_RATE = 0.5;
  const nodeKindByKey = new Map(nodes.map((n) => [n.domainKey, n.nodeKind]));
  const isExhaustedLeaf = (key: string): boolean => {
    if (nodeKindByKey.get(key) === 'parent') return false;
    const gen = ownGenByKey[key];
    if (!gen || gen.total < POOL_THRESHOLD) return false; // not mined enough to judge
    if ((ownMachineDepthByKey[key] ?? 0) >= POOL_THRESHOLD) return false; // pool is healthy
    const dupRate = gen.total > 0 ? gen.dupes / gen.total : 0;
    return (ownMachineDepthByKey[key] ?? 0) === 0 || dupRate >= EXHAUSTED_DUP_RATE;
  };

  const depthByKey: Record<string, number> = { ...ownDepthByKey };
  const pointsByKey: Record<string, number> = { ...ownPointsByKey };
  const genStatsByKey: Record<string, { total: number; dupes: number }> = {};
  // self = this leaf is exhausted; descendants = exhausted leaves under a parent.
  const exhaustedByKey: Record<string, { self: boolean; descendants: number }> = {};
  for (const node of nodes) {
    const key = node.domainKey;
    const descendants = new Set<string>();
    const stack = [...(childrenByParent.get(key) ?? [])];
    while (stack.length > 0) {
      const child = stack.pop()!;
      if (child === key || descendants.has(child)) continue; // cycle/diamond guard
      descendants.add(child);
      stack.push(...(childrenByParent.get(child) ?? []));
    }
    let depthSum = ownDepthByKey[key] ?? 0;
    let pointsSum = ownPointsByKey[key] ?? 0;
    let genTotal = ownGenByKey[key]?.total ?? 0;
    let genDupes = ownGenByKey[key]?.dupes ?? 0;
    let exhaustedDescendants = 0;
    for (const d of descendants) {
      depthSum += ownDepthByKey[d] ?? 0;
      pointsSum += ownPointsByKey[d] ?? 0;
      genTotal += ownGenByKey[d]?.total ?? 0;
      genDupes += ownGenByKey[d]?.dupes ?? 0;
      if (isExhaustedLeaf(d)) exhaustedDescendants += 1;
    }
    depthByKey[key] = depthSum;
    pointsByKey[key] = pointsSum;
    genStatsByKey[key] = { total: genTotal, dupes: genDupes };
    exhaustedByKey[key] = { self: isExhaustedLeaf(key), descendants: exhaustedDescendants };
  }

  // UNFILED areas ("show all areas, not just the ones I did", 2026-07-08):
  // every corpus label whose folded key has NO authored node — questions exist
  // there, but the territory isn't in the tree yet. Shown below the tree with
  // an add-to-tree action, so the graph page is the complete picture instead of
  // only the authored subset. Display label = the deepest spelling per key
  // (spelling variants fold to one row); sorted most-questions-first so the
  // biggest missing territories surface at the top.
  const nodeKeySet = new Set(nodes.map((n) => n.domainKey));
  const bestLabelByKey = new Map<string, { label: string; depth: number }>();
  for (const entry of corpusDepths) {
    const key = domainKey(entry.label);
    if (nodeKeySet.has(key)) continue;
    const depth = entry.machineDepth + entry.humanAuthored;
    const best = bestLabelByKey.get(key);
    if (!best || depth > best.depth) bestLabelByKey.set(key, { label: entry.label, depth });
  }
  const unfiled = [...bestLabelByKey.entries()]
    .map(([key, { label }]) => ({
      domainKey: key,
      label,
      questions: ownDepthByKey[key] ?? 0,
      points: ownPointsByKey[key] ?? 0,
      genTotal: ownGenByKey[key]?.total ?? 0,
      genDupes: ownGenByKey[key]?.dupes ?? 0,
      exhausted: isExhaustedLeaf(key),
    }))
    .filter((area) => area.questions > 0)
    .sort((a, b) => b.questions - a.questions || a.label.localeCompare(b.label));

  // Per-key supply readout for the row chips. Serializable subset only.
  const supplyByKey: Record<string, SupplyReadout> = {};
  for (const entry of supply?.entries ?? []) {
    supplyByKey[entry.domainKey] = {
      state: entry.state,
      realized: entry.realized,
      estimatedQuestions: entry.estimatedQuestions,
      ratio: entry.ratio,
      capped: entry.generationCapped,
      corpusEstimatedQuestions: entry.corpusEstimatedQuestions,
      fandomHost: entry.fandomHost,
      hasEverYielded: entry.lastYieldAt != null,
      consecutiveDryRounds: entry.consecutiveDryRounds,
    };
  }

  return (
    <KnowledgeAdminClient
      nodes={nodes}
      edges={edges}
      depthByKey={depthByKey}
      pointsByKey={pointsByKey}
      genStatsByKey={genStatsByKey}
      exhaustedByKey={exhaustedByKey}
      unfiled={unfiled}
      supplyByKey={supplyByKey}
    />
  );
}
