import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { getCorpusLabelDepths, getCorpusLabelPoints } from '@/server/db/queries/crafter-demand';
import { listKnowledgeGraph } from '@/server/db/queries/knowledge-graph';
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

  const [{ nodes, edges }, corpusDepths, corpusPoints] = await Promise.all([
    listKnowledgeGraph(),
    // Per-label question depth (machine + human), so the tree can flag
    // territories too thin to stand alone ("this is too small — condense it").
    getCorpusLabelDepths(),
    // Per-label points currently available (difficulty-weighted), shown next to
    // Qs so a curator can eyeball it against the node's mastery threshold.
    getCorpusLabelPoints(),
  ]);
  const ownDepthByKey: Record<string, number> = {};
  for (const entry of corpusDepths) {
    ownDepthByKey[domainKey(entry.label)] = entry.machineDepth + entry.humanAuthored;
  }
  const ownPointsByKey: Record<string, number> = {};
  for (const entry of corpusPoints) {
    ownPointsByKey[domainKey(entry.label)] = (ownPointsByKey[domainKey(entry.label)] ?? 0) + entry.points;
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
  const depthByKey: Record<string, number> = { ...ownDepthByKey };
  const pointsByKey: Record<string, number> = { ...ownPointsByKey };
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
    for (const d of descendants) {
      depthSum += ownDepthByKey[d] ?? 0;
      pointsSum += ownPointsByKey[d] ?? 0;
    }
    depthByKey[key] = depthSum;
    pointsByKey[key] = pointsSum;
  }

  return (
    <KnowledgeAdminClient
      nodes={nodes}
      edges={edges}
      depthByKey={depthByKey}
      pointsByKey={pointsByKey}
    />
  );
}
