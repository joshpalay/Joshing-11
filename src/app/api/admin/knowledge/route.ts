import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import {
  createKnowledgeEdge,
  createKnowledgeNode,
  deleteKnowledgeEdge,
  updateKnowledgeNode,
} from '@/server/db/queries/knowledge-graph';

export const dynamic = 'force-dynamic';

// B-KNOWLEDGE-ADMIN-01 P1 — the human-authoring API for the knowledge graph
// (D-doc §4: structure is human-authored; no auto-mint). Edits nodes, edges,
// thresholds, and edge types ONLY — never questions, mastery, or player data.
// The domainKey collision response carries the existing node so the client can
// surface it and offer edit instead (the anti-fragmentation tripwire).

const nodeKindSchema = z.enum(['leaf', 'parent', 'both']);
const edgeTypeSchema = z.enum(['substantive', 'collection']);
const keySchema = z.string().trim().min(1).max(160);

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_node'),
    label: z.string().trim().min(1).max(120),
    nodeKind: nodeKindSchema,
    masteryThreshold: z.number().int().min(1).max(1_000_000).nullable().optional(),
    broadCategory: z.string().trim().max(80).nullable().optional(),
    fieldHue: z.string().trim().max(40).nullable().optional(),
  }),
  z.object({
    action: z.literal('edit_node'),
    id: z.string().trim().min(1),
    label: z.string().trim().min(1).max(120).optional(),
    nodeKind: nodeKindSchema.optional(),
    masteryThreshold: z.number().int().min(1).max(1_000_000).nullable().optional(),
    broadCategory: z.string().trim().max(80).nullable().optional(),
    fieldHue: z.string().trim().max(40).nullable().optional(),
  }),
  z.object({
    action: z.literal('create_edge'),
    childDomainKey: keySchema,
    parentDomainKey: keySchema,
    edgeType: edgeTypeSchema,
  }),
  z.object({
    action: z.literal('delete_edge'),
    childDomainKey: keySchema,
    parentDomainKey: keySchema,
  }),
]);

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

  switch (data.action) {
    case 'create_node': {
      const result = await createKnowledgeNode(
        {
          label: data.label,
          nodeKind: data.nodeKind,
          masteryThreshold: data.masteryThreshold ?? null,
          broadCategory: data.broadCategory ?? null,
          fieldHue: data.fieldHue ?? null,
        },
        session.userId,
      );
      if (!result.ok) {
        // 409 with the existing node — the client surfaces it and offers edit.
        return NextResponse.json(
          { error: result.reason, existing: 'existing' in result ? result.existing : null },
          { status: 409 },
        );
      }
      return NextResponse.json({ node: result.node }, { status: 201 });
    }

    case 'edit_node': {
      const result = await updateKnowledgeNode(data, session.userId);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.reason, existing: 'existing' in result ? result.existing : null },
          { status: result.reason === 'not_found' ? 404 : 409 },
        );
      }
      return NextResponse.json({ node: result.node });
    }

    case 'create_edge': {
      const result = await createKnowledgeEdge(
        {
          childDomainKey: data.childDomainKey,
          parentDomainKey: data.parentDomainKey,
          edgeType: data.edgeType,
        },
        session.userId,
      );
      if (!result.ok) {
        const status =
          result.reason === 'self_edge' ? 400 : result.reason === 'unknown_node' ? 422 : 409;
        return NextResponse.json({ error: result.reason }, { status });
      }
      return NextResponse.json({ edge: result.edge }, { status: 201 });
    }

    case 'delete_edge': {
      const result = await deleteKnowledgeEdge(
        { childDomainKey: data.childDomainKey, parentDomainKey: data.parentDomainKey },
        session.userId,
      );
      if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }
  }
}
