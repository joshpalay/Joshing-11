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
import { domainKey } from '@/lib/knowledge/domain-key';

import { KnowledgeAdminClient } from './KnowledgeAdminClient';

export const dynamic = 'force-dynamic';

// B-KNOWLEDGE-ADMIN-01 P1 — the human-authoring surface for the knowledge
// graph (D-doc §4). Structure only: nodes, edges, thresholds, edge types.
// Same gate contract as every admin page: ADMIN_USER_IDS or Next's 404 —
// the route's existence is not revealed.
export default async function AdminKnowledgePage() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  const [{ nodes, edges }, corpusDepths, corpusPoints, corpusGenStats] = await Promise.all([
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
  // "Capped" = tapped out at the narrow-KB / area-expansion gate boundary
  // (kb-exhaustion.ts fires below `poolDepthThreshold` servable facts, where the
  // system stops serving fresh Qs and pushes expansion). To mean EXHAUSTED, not
  // merely under-generated, a leaf must (a) have been mined (generated ≥ threshold
  // times), (b) still hold fewer than threshold servable machine facts, AND (c)
  // show generation actually hitting a wall — mostly duplicates, or producing
  // nothing servable at all. A big topic with a low dup rate stays "needs
  // generation", not capped.
  const POOL_THRESHOLD = getRetrievalConfig().poolDepthThreshold;
  const CAPPED_DUP_RATE = 0.5;
  const nodeKindByKey = new Map(nodes.map((n) => [n.domainKey, n.nodeKind]));
  const isCappedLeaf = (key: string): boolean => {
    if (nodeKindByKey.get(key) === 'parent') return false;
    const gen = ownGenByKey[key];
    if (!gen || gen.total < POOL_THRESHOLD) return false; // not mined enough to judge
    if ((ownMachineDepthByKey[key] ?? 0) >= POOL_THRESHOLD) return false; // pool is healthy
    const dupRate = gen.total > 0 ? gen.dupes / gen.total : 0;
    return (ownMachineDepthByKey[key] ?? 0) === 0 || dupRate >= CAPPED_DUP_RATE;
  };

  const depthByKey: Record<string, number> = { ...ownDepthByKey };
  const pointsByKey: Record<string, number> = { ...ownPointsByKey };
  const genStatsByKey: Record<string, { total: number; dupes: number }> = {};
  // self = this leaf is capped; descendants = capped leaves under a parent.
  const cappedByKey: Record<string, { self: boolean; descendants: number }> = {};
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
    let cappedDescendants = 0;
    for (const d of descendants) {
      depthSum += ownDepthByKey[d] ?? 0;
      pointsSum += ownPointsByKey[d] ?? 0;
      genTotal += ownGenByKey[d]?.total ?? 0;
      genDupes += ownGenByKey[d]?.dupes ?? 0;
      if (isCappedLeaf(d)) cappedDescendants += 1;
    }
    depthByKey[key] = depthSum;
    pointsByKey[key] = pointsSum;
    genStatsByKey[key] = { total: genTotal, dupes: genDupes };
    cappedByKey[key] = { self: isCappedLeaf(key), descendants: cappedDescendants };
  }

  return (
    <KnowledgeAdminClient
      nodes={nodes}
      edges={edges}
      depthByKey={depthByKey}
      pointsByKey={pointsByKey}
      genStatsByKey={genStatsByKey}
      cappedByKey={cappedByKey}
    />
  );
}
