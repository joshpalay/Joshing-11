import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import {
  attachChild,
  createKnowledgeEdge,
  createKnowledgeNode,
  deleteKnowledgeEdge,
  invertKnowledgeEdge,
  listQuestionsForDomain,
  ratifyProposedParent,
  ratifyStructureGroup,
  updateKnowledgeNode,
} from '@/server/db/queries/knowledge-graph';
import { proposeKnowledgeStructure } from '@/server/knowledge/propose-structure';
import { mergeDomainIntoTarget } from '@/server/knowledge/merge-domain';
import { computeNodeWeight } from '@/server/knowledge/node-weight';
import { domainKey } from '@/lib/knowledge/domain-key';

export const dynamic = 'force-dynamic';

// B-KNOWLEDGE-ADMIN-01 P1 — the human-authoring API for the knowledge graph
// (D-doc §4: structure is human-authored; no auto-mint). Edits nodes, edges,
// thresholds, and edge types ONLY — never questions, mastery, or player data.
// The domainKey collision response carries the existing node so the client can
// surface it and offer edit instead (the anti-fragmentation tripwire).

const nodeKindSchema = z.enum(['leaf', 'parent', 'both']);
const keySchema = z.string().trim().min(1).max(160);

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_node'),
    label: z.string().trim().min(1).max(120),
    nodeKind: nodeKindSchema,
    masteryThreshold: z.number().int().min(1).max(1_000_000).nullable().optional(),
    broadCategory: z.string().trim().max(80).nullable().optional(),
    fieldHue: z.string().trim().max(40).nullable().optional(),
    nodeWeight: z.number().int().min(1).max(10).nullable().optional(),
  }),
  z.object({
    action: z.literal('edit_node'),
    id: z.string().trim().min(1),
    label: z.string().trim().min(1).max(120).optional(),
    nodeKind: nodeKindSchema.optional(),
    masteryThreshold: z.number().int().min(1).max(1_000_000).nullable().optional(),
    broadCategory: z.string().trim().max(80).nullable().optional(),
    fieldHue: z.string().trim().max(40).nullable().optional(),
    nodeWeight: z.number().int().min(1).max(10).nullable().optional(),
  }),
  z.object({
    action: z.literal('create_edge'),
    childDomainKey: keySchema,
    parentDomainKey: keySchema,
  }),
  z.object({
    action: z.literal('delete_edge'),
    childDomainKey: keySchema,
    parentDomainKey: keySchema,
  }),
  // P3: PROPOSED parent edges for a leaf, from two sources — Wikidata (the
  // preferred proposer: a clean is-a ontology, direct edges only) and the
  // near-ness LLM (for hyper-specific territories Wikidata won't cover). Each
  // proposal carries its provenance. Suggestions only — nothing persists until
  // a human ratifies.
  z.object({ action: z.literal('propose'), childLabel: z.string().trim().min(1).max(120) }),
  // P3: the human commit. Creates the parent node if it doesn't exist yet
  // (part of the deliberate ratify act, §4) and draws the containment edge.
  // wikidataQid present ⇒ stored on the parent node for provenance.
  z.object({
    action: z.literal('ratify'),
    childDomainKey: keySchema,
    parentLabel: z.string().trim().min(1).max(120),
    parentBroadCategory: z.string().trim().max(80).nullable().optional(),
    wikidataQid: z.string().regex(/^Q\d+$/).nullable().optional(),
  }),
  // Tree-editor verb: attach child under parent — MOVE when moveFrom present
  // (old home edge removed), COPY otherwise (§7 multi-parent). Filing under a
  // leaf promotes it to 'both'.
  z.object({
    action: z.literal('attach_child'),
    childDomainKey: keySchema,
    toParentDomainKey: keySchema,
    moveFromParentDomainKey: keySchema.nullable().optional(),
  }),
  // Read-only peek at a territory's actual questions — the sanity check before
  // moving or merging it.
  z.object({ action: z.literal('list_questions'), domainKey: keySchema }),
  // Flip a child above its own parent (the child inherits the parent's
  // memberships; the parent files under the child).
  z.object({
    action: z.literal('invert_edge'),
    childDomainKey: keySchema,
    parentDomainKey: keySchema,
  }),
  // Fold one territory into another — questions, mastery, and history move to
  // the target; the source ceases to exist. Irreversible; for SAME-SCOPE
  // duplicates only (containment is an edge, never a merge).
  z.object({
    action: z.literal('merge_node'),
    sourceDomainKey: keySchema,
    targetDomainKey: keySchema,
  }),
  // The structure suggester: one LLM pass drafts a full grouping of the real
  // corpus; NOTHING persists (suggestions live only in the response).
  z.object({ action: z.literal('propose_structure') }),
  // The human's Accept on one proposed group — mints parent + child nodes and
  // substantive edges on the normal rails, with the human-tuned threshold.
  z.object({
    action: z.literal('ratify_structure_group'),
    parentLabel: z.string().trim().min(1).max(120),
    broadCategory: z.string().trim().max(80).nullable().optional(),
    masteryThreshold: z.number().int().min(100).max(1_000_000).nullable().optional(),
    childLabels: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
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
      // Mastery v2: seed the depth weight when the admin didn't set one
      // (Wikidata child-count → LLM fallback; null when neither resolves).
      const nodeWeight = data.nodeWeight ?? (await computeNodeWeight(data.label)).weight;
      const result = await createKnowledgeNode(
        {
          label: data.label,
          nodeKind: data.nodeKind,
          masteryThreshold: data.masteryThreshold ?? null,
          broadCategory: data.broadCategory ?? null,
          fieldHue: data.fieldHue ?? null,
          nodeWeight,
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
      return NextResponse.json({ node: result.node, corpusWarning: result.corpusWarning ?? null });
    }

    case 'create_edge': {
      const result = await createKnowledgeEdge(
        {
          childDomainKey: data.childDomainKey,
          parentDomainKey: data.parentDomainKey,
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

    case 'propose': {
      // Graceful degrade (slate P3): every source that is unavailable —
      // Wikidata egress blocked, near-ness module missing, nothing cached —
      // simply contributes nothing. An empty queue is fine; manual authoring
      // is always sufficient. Never an error the author has to care about.
      const childKey = domainKey(data.childLabel);
      const proposals: Array<{
        label: string;
        broadCategory: string | null;
        rung: 'parent' | 'grandparent';
        parentDomainKey: string;
        source: 'wikidata' | 'llm';
        qid: string | null;
        description: string | null;
      }> = [];
      const seenKeys = new Set<string>([childKey]); // never propose the child as its own parent

      // Wikidata first — the preferred proposer. Direct is-a edges only
      // (depth 1); the module never throws, but guard the import too.
      try {
        const { getWikidataStructure } = await import('@/server/knowledge/wikidata');
        const structure = await getWikidataStructure(data.childLabel);
        for (const parent of structure?.parents ?? []) {
          const key = domainKey(parent.label);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          proposals.push({
            label: parent.label,
            broadCategory: null,
            rung: 'parent',
            parentDomainKey: key,
            source: 'wikidata',
            qid: parent.qid,
            description: parent.description,
          });
        }
      } catch {
        // degrade — the LLM source (or manual entry) still serves
      }

      // Near-ness LLM second — covers hyper-specific Joshing territories
      // Wikidata won't have ("Spy School Books 1-6").
      try {
        const { getOrBuildDomainRungs } = await import('@/server/knowledge/nearness-tree');
        const rungs = await getOrBuildDomainRungs(data.childLabel);
        for (const r of rungs) {
          if (r.rung !== 'parent' && r.rung !== 'grandparent') continue;
          const key = domainKey(r.domain);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          proposals.push({
            label: r.domain,
            broadCategory: r.broadCategory,
            rung: r.rung,
            parentDomainKey: key,
            source: 'llm',
            qid: null,
            description: null,
          });
        }
      } catch {
        // degrade — whatever Wikidata found (possibly nothing) still returns
      }

      return NextResponse.json({ proposals });
    }

    case 'attach_child': {
      const result = await attachChild(
        {
          childDomainKey: data.childDomainKey,
          toParentDomainKey: data.toParentDomainKey,
          moveFromParentDomainKey: data.moveFromParentDomainKey ?? null,
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

    case 'list_questions': {
      const result = await listQuestionsForDomain(data.domainKey);
      if (!result) return NextResponse.json({ error: 'unknown_node' }, { status: 422 });
      return NextResponse.json(result);
    }

    case 'invert_edge': {
      const result = await invertKnowledgeEdge(
        { childDomainKey: data.childDomainKey, parentDomainKey: data.parentDomainKey },
        session.userId,
      );
      if (!result.ok) {
        return NextResponse.json(
          { error: result.reason },
          { status: result.reason === 'self_edge' ? 400 : 404 },
        );
      }
      return NextResponse.json(result);
    }

    case 'merge_node': {
      const result = await mergeDomainIntoTarget(
        { sourceDomainKey: data.sourceDomainKey, targetDomainKey: data.targetDomainKey },
        session.userId,
      );
      if (!result.ok) {
        const status =
          result.reason === 'self_merge' ? 400 : result.reason === 'unknown_node' ? 422 : 409;
        return NextResponse.json({ error: result.reason, detail: result.detail }, { status });
      }
      return NextResponse.json(result);
    }

    case 'propose_structure': {
      const result = await proposeKnowledgeStructure();
      if (!result.ok) {
        const status = result.reason === 'corpus_empty' ? 200 : 503;
        return NextResponse.json(
          result.reason === 'corpus_empty'
            ? { groups: [], corpusSize: 0, alreadyStructured: 0 }
            : { error: result.reason },
          { status },
        );
      }
      return NextResponse.json({
        groups: result.groups,
        corpusSize: result.corpusSize,
        alreadyStructured: result.alreadyStructured,
      });
    }

    case 'ratify_structure_group': {
      const result = await ratifyStructureGroup(
        {
          parentLabel: data.parentLabel,
          broadCategory: data.broadCategory ?? null,
          masteryThreshold: data.masteryThreshold ?? null,
          childLabels: data.childLabels,
        },
        session.userId,
      );
      return NextResponse.json(result, { status: 201 });
    }

    case 'ratify': {
      const result = await ratifyProposedParent(
        {
          childDomainKey: data.childDomainKey,
          parentLabel: data.parentLabel,
          parentBroadCategory: data.parentBroadCategory ?? null,
          wikidataQid: data.wikidataQid ?? null,
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
  }
}
