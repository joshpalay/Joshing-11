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

// B-KNOWLEDGE-ADMIN-01 P3 — ratify an LLM-proposed parent edge. The ratify
// click IS the human commit (§4): if no node exists at the proposed parent's
// key, one is minted HERE (as part of the deliberate ratify act, never by the
// proposal itself), nodeKind 'parent' with a null threshold for the human to
// set later. Then the typed edge is drawn on the normal rails.
export async function ratifyProposedParent(
  input: {
    childDomainKey: string;
    parentLabel: string;
    parentBroadCategory: string | null;
    edgeType: EdgeType;
  },
  actorUserId: string,
): Promise<EdgeResult> {
  const parentKey = domainKey(input.parentLabel);

  const [existing] = await db
    .select({ id: knowledgeNodes.id })
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.domainKey, parentKey))
    .limit(1);
  if (!existing) {
    const created = await createKnowledgeNode(
      {
        label: input.parentLabel,
        nodeKind: 'parent',
        masteryThreshold: null,
        broadCategory: input.parentBroadCategory,
        fieldHue: null,
      },
      actorUserId,
    );
    // A collision here means the node raced into existence — fine, the edge
    // below targets it either way.
    if (!created.ok && created.reason === 'not_found') {
      return { ok: false, reason: 'unknown_node' };
    }
  }

  return createKnowledgeEdge(
    { childDomainKey: input.childDomainKey, parentDomainKey: parentKey, edgeType: input.edgeType },
    actorUserId,
  );
}

// Tree-editor verb: attach a child under a parent (substantive), optionally
// moving it FROM its current parent in the same act. Ordering is
// create-before-delete so a fault can duplicate an edge but never orphan the
// child. Filing something under a LEAF promotes that leaf to 'both' (D-doc §3
// — Bach is masterable AND parent of WTC); its leaf mastery is untouched.
export async function attachChild(
  input: {
    childDomainKey: string;
    toParentDomainKey: string;
    /** Present = MOVE (the old home edge is removed); absent = COPY (§7 multi-parent). */
    moveFromParentDomainKey?: string | null;
  },
  actorUserId: string,
): Promise<EdgeResult> {
  if (input.childDomainKey === input.toParentDomainKey) {
    return { ok: false, reason: 'self_edge' };
  }

  // Reject a move/copy that would create a cycle: the destination must not be
  // a descendant of the child (walking all substantive edges).
  const allEdges = await db
    .select({
      childDomainKey: knowledgeEdges.childDomainKey,
      parentDomainKey: knowledgeEdges.parentDomainKey,
      edgeType: knowledgeEdges.edgeType,
    })
    .from(knowledgeEdges);
  const childrenByParent = new Map<string, string[]>();
  for (const edge of allEdges) {
    if (edge.edgeType !== 'substantive') continue;
    const list = childrenByParent.get(edge.parentDomainKey);
    if (list) list.push(edge.childDomainKey);
    else childrenByParent.set(edge.parentDomainKey, [edge.childDomainKey]);
  }
  const seen = new Set<string>();
  const queue = [input.childDomainKey];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    if (next === input.toParentDomainKey && next !== input.childDomainKey) {
      return { ok: false, reason: 'self_edge' }; // destination is inside the child's subtree
    }
    queue.push(...(childrenByParent.get(next) ?? []));
  }

  const created = await createKnowledgeEdge(
    {
      childDomainKey: input.childDomainKey,
      parentDomainKey: input.toParentDomainKey,
      edgeType: 'substantive',
    },
    actorUserId,
  );
  // A duplicate edge on COPY/MOVE is fine — the relationship already exists;
  // continue so a MOVE still removes the old home.
  if (!created.ok && created.reason !== 'duplicate') return created;

  // Promote a leaf destination to 'both' — it just became a parent.
  await db
    .update(knowledgeNodes)
    .set({ nodeKind: 'both' })
    .where(and(eq(knowledgeNodes.domainKey, input.toParentDomainKey), eq(knowledgeNodes.nodeKind, 'leaf')));

  if (input.moveFromParentDomainKey && input.moveFromParentDomainKey !== input.toParentDomainKey) {
    await deleteKnowledgeEdge(
      {
        childDomainKey: input.childDomainKey,
        parentDomainKey: input.moveFromParentDomainKey,
      },
      actorUserId,
    );
  }

  console.info('[knowledge-admin] child attached', { actorUserId, ...input });
  if (created.ok) return created;
  // Duplicate-create path: fetch the existing edge for a uniform return.
  const [existing] = await db
    .select()
    .from(knowledgeEdges)
    .where(
      and(
        eq(knowledgeEdges.childDomainKey, input.childDomainKey),
        eq(knowledgeEdges.parentDomainKey, input.toParentDomainKey),
      ),
    )
    .limit(1);
  return existing ? { ok: true, edge: existing } : { ok: false, reason: 'not_found' };
}

// Structure-suggester ratify (§4: the Accept click IS the human commit): mint
// the parent (kind 'parent', human-tuned threshold), ensure a leaf node for
// each accepted child (they're REAL corpus labels — the node is the label's
// entry into the graph), and draw substantive edges. Existing nodes are reused
// via the collision path — never duplicated.
export async function ratifyStructureGroup(
  input: {
    parentLabel: string;
    broadCategory: string | null;
    masteryThreshold: number | null;
    childLabels: string[];
  },
  actorUserId: string,
): Promise<{ ok: true; parentKey: string; edgesCreated: number }> {
  const ensureNode = async (
    label: string,
    nodeKind: NodeKind,
    masteryThreshold: number | null,
    broadCategory: string | null,
  ): Promise<string> => {
    const created = await createKnowledgeNode(
      { label, nodeKind, masteryThreshold, broadCategory, fieldHue: null },
      actorUserId,
    );
    if (created.ok) return created.node.domainKey;
    if (created.reason === 'domain_key_collision') return created.existing.domainKey;
    return domainKey(label);
  };

  const parentKey = await ensureNode(
    input.parentLabel,
    'parent',
    input.masteryThreshold,
    input.broadCategory,
  );

  let edgesCreated = 0;
  for (const childLabel of input.childLabels) {
    const childKey = await ensureNode(childLabel, 'leaf', null, input.broadCategory);
    if (childKey === parentKey) continue;
    const edge = await createKnowledgeEdge(
      { childDomainKey: childKey, parentDomainKey: parentKey, edgeType: 'substantive' },
      actorUserId,
    );
    if (edge.ok) edgesCreated += 1; // duplicates are fine — already ratified
  }

  console.info('[knowledge-admin] structure group ratified', {
    actorUserId,
    parent: input.parentLabel,
    children: input.childLabels.length,
    edgesCreated,
  });
  return { ok: true, parentKey, edgesCreated };
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
