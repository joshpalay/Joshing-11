import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { listKnowledgeGraph } from '@/server/db/queries/knowledge-graph';

import { KnowledgeAdminClient } from './KnowledgeAdminClient';

export const dynamic = 'force-dynamic';

// B-KNOWLEDGE-ADMIN-01 P1 — the human-authoring surface for the knowledge
// graph (D-doc §4). Structure only: nodes, edges, thresholds, edge types.
// Same gate contract as every admin page: ADMIN_USER_IDS or Next's 404 —
// the route's existence is not revealed.
export default async function AdminKnowledgePage() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  const { nodes, edges } = await listKnowledgeGraph();
  return <KnowledgeAdminClient nodes={nodes} edges={edges} />;
}
