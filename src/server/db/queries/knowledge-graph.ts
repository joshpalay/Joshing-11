import { and, asc, eq } from 'drizzle-orm';

import { db, knowledgeEdges, knowledgeNodes } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';

// B-KNOWLEDGE-ADMIN-01 P1 — write layer for the human-authored knowledge graph
// (D-KNOWLEDGE-TAXONOMY-MODEL-01 §4: structure is a human decision; the LLM
// only proposes). Every write here is a deliberate, logged act. This module
// touches ONLY KnowledgeNode/KnowledgeEdge — never questions, playerMastery,
// or masteryEvents. The domainKey collision check is the fragmentation
// tripwire this whole model exists to enforce: a label that folds onto an
// existing node must surface that node, never mint a sibling.

export type NodeKind = 'leaf' | 'parent' | 'both';
export type EdgeType = 'substantive' | 'collection';

export type KnowledgeNodeRow = typeof knowledgeNodes.$inferSelect;
export type KnowledgeEdgeRow = typeof knowledgeEdges.$inferSelect;

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

export async function listKnowledgeGraph(): Promise<{
  nodes: KnowledgeNodeRow[];
  edges: KnowledgeEdgeRow[];
}> {
  const [nodes, edges] = await Promise.all([
    db.select().from(knowledgeNodes).orderBy(asc(knowledgeNodes.label)),
    db.select().from(knowledgeEdges).orderBy(asc(knowledgeEdges.parentDomainKey)),
  ]);
  return { nodes, edges };
}

export type CreateNodeInput = {
  label: string;
  nodeKind: NodeKind;
  masteryThreshold: number | null;
  broadCategory: string | null;
  fieldHue: string | null;
};

export type NodeResult =
  | { ok: true; node: KnowledgeNodeRow }
  | { ok: false; reason: 'domain_key_collision'; existing: KnowledgeNodeRow }
  | { ok: false; reason: 'not_found' };

export async function createKnowledgeNode(
  input: CreateNodeInput,
  actorUserId: string,
): Promise<NodeResult> {
  const key = domainKey(input.label);

  const [existing] = await db
    .select()
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.domainKey, key))
    .limit(1);
  if (existing) {
    // The fragmentation tripwire — surface the existing node, offer edit.
    return { ok: false, reason: 'domain_key_collision', existing };
  }

  try {
    const [node] = await db
      .insert(knowledgeNodes)
      .values({
        label: input.label.trim(),
        domainKey: key,
        nodeKind: input.nodeKind,
        masteryThreshold: input.masteryThreshold,
        broadCategory: input.broadCategory,
        fieldHue: input.fieldHue,
      })
      .returning();
    console.info('[knowledge-admin] node created', { actorUserId, label: input.label, key });
    return { ok: true, node };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [raced] = await db
        .select()
        .from(knowledgeNodes)
        .where(eq(knowledgeNodes.domainKey, key))
        .limit(1);
      if (raced) return { ok: false, reason: 'domain_key_collision', existing: raced };
    }
    throw err;
  }
}

export type UpdateNodeInput = Partial<CreateNodeInput> & { id: string };

// Editing a node's label changes its domainKey — edges are keyed by domainKey
// (so they survive label edits by design), which means a rename must rewrite
// the node's edge keys in the same act. Threshold edits never touch mastery
// here: mastery is computed at read (P4) and earned mastery is never revoked
// (§5) — the ADMIN P2 impact preview is where a risky lowering gets a warning.
export async function updateKnowledgeNode(
  input: UpdateNodeInput,
  actorUserId: string,
): Promise<NodeResult> {
  const [node] = await db
    .select()
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.id, input.id))
    .limit(1);
  if (!node) return { ok: false, reason: 'not_found' };

  const nextLabel = input.label?.trim() || node.label;
  const nextKey = domainKey(nextLabel);

  if (nextKey !== node.domainKey) {
    const [collision] = await db
      .select()
      .from(knowledgeNodes)
      .where(eq(knowledgeNodes.domainKey, nextKey))
      .limit(1);
    if (collision) return { ok: false, reason: 'domain_key_collision', existing: collision };
  }

  const [updated] = await db
    .update(knowledgeNodes)
    .set({
      label: nextLabel,
      domainKey: nextKey,
      ...(input.nodeKind !== undefined ? { nodeKind: input.nodeKind } : {}),
      ...(input.masteryThreshold !== undefined ? { masteryThreshold: input.masteryThreshold } : {}),
      ...(input.broadCategory !== undefined ? { broadCategory: input.broadCategory } : {}),
      ...(input.fieldHue !== undefined ? { fieldHue: input.fieldHue } : {}),
    })
    .where(eq(knowledgeNodes.id, input.id))
    .returning();

  if (nextKey !== node.domainKey) {
    // Rename: carry the node's edges to the new key.
    await db
      .update(knowledgeEdges)
      .set({ childDomainKey: nextKey })
      .where(eq(knowledgeEdges.childDomainKey, node.domainKey));
    await db
      .update(knowledgeEdges)
      .set({ parentDomainKey: nextKey })
      .where(eq(knowledgeEdges.parentDomainKey, node.domainKey));
  }

  console.info('[knowledge-admin] node updated', {
    actorUserId,
    id: input.id,
    renamed: nextKey !== node.domainKey ? { from: node.domainKey, to: nextKey } : false,
  });
  return { ok: true, node: updated };
}

export type EdgeResult =
  | { ok: true; edge: KnowledgeEdgeRow }
  | { ok: false; reason: 'self_edge' | 'unknown_node' | 'duplicate' | 'not_found' };

export async function createKnowledgeEdge(
  input: { childDomainKey: string; parentDomainKey: string; edgeType: EdgeType },
  actorUserId: string,
): Promise<EdgeResult> {
  if (input.childDomainKey === input.parentDomainKey) {
    return { ok: false, reason: 'self_edge' };
  }

  // Both endpoints must be authored nodes — no dangling edges into labels
  // nobody has ratified (§4).
  const [child, parent] = await Promise.all([
    db.select({ id: knowledgeNodes.id }).from(knowledgeNodes).where(eq(knowledgeNodes.domainKey, input.childDomainKey)).limit(1),
    db.select({ id: knowledgeNodes.id }).from(knowledgeNodes).where(eq(knowledgeNodes.domainKey, input.parentDomainKey)).limit(1),
  ]);
  if (child.length === 0 || parent.length === 0) {
    return { ok: false, reason: 'unknown_node' };
  }

  try {
    const [edge] = await db.insert(knowledgeEdges).values(input).returning();
    console.info('[knowledge-admin] edge created', { actorUserId, ...input });
    return { ok: true, edge };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: 'duplicate' };
    throw err;
  }
}

// Deleting an edge is structure-editing, not content removal — the hard delete
// is intentional (the no-hard-delete canon protects player content; an edge is
// an authored relation a human may retract). Exactly the (child, parent) pair.
export async function deleteKnowledgeEdge(
  input: { childDomainKey: string; parentDomainKey: string },
  actorUserId: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' }> {
  const deleted = await db
    .delete(knowledgeEdges)
    .where(
      and(
        eq(knowledgeEdges.childDomainKey, input.childDomainKey),
        eq(knowledgeEdges.parentDomainKey, input.parentDomainKey),
      ),
    )
    .returning({ id: knowledgeEdges.id });
  if (deleted.length === 0) return { ok: false, reason: 'not_found' };
  console.info('[knowledge-admin] edge deleted', { actorUserId, ...input });
  return { ok: true };
}
