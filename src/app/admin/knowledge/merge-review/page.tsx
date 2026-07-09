import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { getDomainFragmentationCandidates } from '@/server/db/queries/domain-fragmentation';
import { listKnowledgeGraph } from '@/server/db/queries/knowledge-graph';
import { domainKey } from '@/lib/knowledge/domain-key';

import { MergeReviewClient, type MergeReviewPair } from './MergeReviewClient';

export const dynamic = 'force-dynamic';

// D-DOMAIN-MERGE-REVIEW-REDESIGN-01 — the interactive review surface for the
// near-duplicate domain pairs the weekly fragmentation cron used to only email.
// Progressive disclosure: each collapsed row offers Merge/Nest + Dismiss;
// expanding reveals the four specific choices grouped by Same-scope / Different-
// scope. Same admin gate as every /admin page (ADMIN_USER_IDS or Next's 404).
export default async function DomainMergeReviewPage() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  const [candidates, { nodes }] = await Promise.all([
    getDomainFragmentationCandidates({ limit: 50 }),
    listKnowledgeGraph(),
  ]);

  // Merge and Nest both operate on KnowledgeNodes — a corpus label with no node
  // can't be merged/nested through the graph API. Surface that per side so the
  // row can show the [IN GRAPH] badge and gate the four actions honestly.
  const nodeKeys = new Set(nodes.map((n) => n.domainKey));

  const pairs: MergeReviewPair[] = candidates.map((c) => {
    const keyA = domainKey(c.domainA);
    const keyB = domainKey(c.domainB);
    return {
      domainA: c.domainA,
      domainB: c.domainB,
      depthA: c.depthA,
      depthB: c.depthB,
      similarity: c.similarity,
      keyA,
      keyB,
      inGraphA: nodeKeys.has(keyA),
      inGraphB: nodeKeys.has(keyB),
    };
  });

  return <MergeReviewClient pairs={pairs} />;
}
