import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { runDomainMergeApply, runDomainMergePreview } from '@/server/db/queries/domain-merges';
import { getLabelQuestionPeek } from '@/server/db/queries/domain-fragmentation';
import { attachChild, createKnowledgeNode } from '@/server/db/queries/knowledge-graph';
import { domainKey } from '@/lib/knowledge/domain-key';

export const dynamic = 'force-dynamic';
// Apply is one transaction over the low-hundreds of rows a label spans; preview is
// a read-only census. Both finish in well under a second, but leave headroom.
export const maxDuration = 60;

// Each decision is one surviving `target` label plus the `source` labels folding
// into it. The UI derives these from the weekly fragmentation candidates; we
// re-validate shape here (never trust the client) and let the shared applier's
// census/ABORT guard do the real safety check against the live corpus.
const mergeSpec = z.object({
  target: z.string().trim().min(1).max(200),
  sources: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
});
// preview/apply act on a batch of merge specs; peek is a read-only sample of one
// label's questions (the "see the questions before you decide" sanity check);
// nest records a CONTAINMENT decision — the pair is parent/child, not
// duplicates — by authoring it into the knowledge graph (nodes created for
// labels that have none, then the edge). A nested pair stops appearing in the
// candidate list (the query filters connected pairs), so "these are related but
// not the same" is a decision you make ONCE, here, instead of leaving the pair
// to nag forever.
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('preview'),
    merges: z.array(mergeSpec).min(1).max(50),
  }),
  z.object({
    action: z.literal('apply'),
    merges: z.array(mergeSpec).min(1).max(50),
  }),
  z.object({
    action: z.literal('peek'),
    label: z.string().trim().min(1).max(200),
  }),
  z.object({
    action: z.literal('nest'),
    childLabel: z.string().trim().min(1).max(200),
    parentLabel: z.string().trim().min(1).max(200),
  }),
]);

// Node-or-existing: the collision result IS success for nesting — the label
// already lives in the graph, which is exactly what we need.
async function ensureNode(
  label: string,
  nodeKind: 'leaf' | 'parent',
  actorUserId: string,
): Promise<boolean> {
  const result = await createKnowledgeNode(
    { label, nodeKind, masteryThreshold: null, broadCategory: null, fieldHue: null },
    actorUserId,
  );
  return result.ok || result.reason === 'domain_key_collision';
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  // Non-admins (and the unauthenticated) get 404 — never reveal the route exists.
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation' }, { status: 400 });
  }

  const data = parsed.data;

  try {
    if (data.action === 'peek') {
      const questions = await getLabelQuestionPeek(data.label);
      return NextResponse.json({ questions });
    }
    if (data.action === 'nest') {
      const childKey = domainKey(data.childLabel);
      const parentKey = domainKey(data.parentLabel);
      if (childKey === parentKey) {
        return NextResponse.json({ error: 'self_edge' }, { status: 400 });
      }
      // Both labels enter the graph (no-op for sides that already have a node),
      // then the containment edge. attachChild handles cycle rejection and
      // promotes a leaf parent to 'both'.
      const childOk = await ensureNode(data.childLabel, 'leaf', session.userId);
      const parentOk = await ensureNode(data.parentLabel, 'parent', session.userId);
      if (!childOk || !parentOk) {
        return NextResponse.json({ error: 'node_create_failed' }, { status: 500 });
      }
      const edge = await attachChild(
        { childDomainKey: childKey, toParentDomainKey: parentKey },
        session.userId,
      );
      if (!edge.ok && edge.reason !== 'duplicate') {
        return NextResponse.json(
          { error: edge.reason },
          { status: edge.reason === 'self_edge' ? 400 : 422 },
        );
      }
      return NextResponse.json({ ok: true });
    }
    const { merges } = data;
    if (data.action === 'preview') {
      const preview = await runDomainMergePreview(merges);
      return NextResponse.json(preview);
    }
    const result = await runDomainMergeApply(merges);
    // An unhandled-table abort or a no-op is a client-actionable 409, not a 500.
    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[admin/domain-merges] failed', error);
    return NextResponse.json({ error: 'merge_failed' }, { status: 500 });
  }
}
