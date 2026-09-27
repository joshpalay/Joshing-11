import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { PoolClient } from 'pg';

import { db, pool, generatedQuestions, knowledgeEdges, knowledgeNodes, questions } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';

// B-KNOWLEDGE-ADMIN-01 P1 — write layer for the human-authored knowledge graph
// (D-KNOWLEDGE-TAXONOMY-MODEL-01 §4: structure is a human decision; the LLM
// only proposes). Every write here is a deliberate, logged act. This module
// delegates renames to the shared corpus/graph transaction so all territory
// references change together. The domainKey collision check is the
// fragmentation tripwire: a label that folds onto an existing node must
// surface that node, never mint a sibling.

export type NodeKind = 'leaf' | 'parent' | 'both';

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

export type DomainQuestionPeek = {
  text: string;
  answer: string;
  source: 'canonical' | 'bank';
  suppressed: boolean;
};

// A read-only peek at what actually lives in a territory — the admin sanity
// check before moving/merging it. Canonical rows match on the node's exact
// label; bank rows match on domain_key (the folded form), so spelling variants
// still show. Newest first, canonical before bank, capped.
export async function listQuestionsForDomain(
  key: string,
  limit = 20,
): Promise<{ label: string; questions: DomainQuestionPeek[] } | null> {
  const [node] = await db
    .select({ label: knowledgeNodes.label })
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.domainKey, key))
    .limit(1);
  if (!node) return null;

  const [canonical, bank] = await Promise.all([
    db
      .select({
        text: questions.questionText,
        answer: questions.answerText,
        status: questions.publicStatus,
      })
      .from(questions)
      .where(and(eq(questions.canonicalSubcategory, node.label), isNull(questions.deletedAt)))
      .orderBy(desc(questions.createdAt))
      .limit(limit),
    db
      .select({
        text: generatedQuestions.questionText,
        answer: generatedQuestions.answer,
        isDuplicate: generatedQuestions.isDuplicate,
      })
      .from(generatedQuestions)
      .where(eq(generatedQuestions.domainKey, key))
      .orderBy(desc(generatedQuestions.createdAt))
      .limit(limit),
  ]);

  const rows: DomainQuestionPeek[] = [
    ...canonical.map((q) => ({
      text: q.text,
      answer: q.answer,
      source: 'canonical' as const,
      suppressed: q.status === 'needs_review' || q.status === 'rejected',
    })),
    ...bank.map((q) => ({
      text: q.text,
      answer: q.answer,
      source: 'bank' as const,
      suppressed: q.isDuplicate,
    })),
  ].slice(0, limit);

  return { label: node.label, questions: rows };
}

export type CreateNodeInput = {
  label: string;
  nodeKind: NodeKind;
  masteryThreshold: number | null;
  broadCategory: string | null;
  fieldHue: string | null;
  /** Wikidata provenance (ADMIN-01 P3) — set when the node is ratified from a Wikidata proposal. */
  wikidataQid?: string | null;
};

export type NodeResult =
  | { ok: true; node: KnowledgeNodeRow }
  | { ok: false; reason: 'domain_key_collision'; existing: KnowledgeNodeRow }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'unhandled_tables'; detail: string[] };

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
        wikidataQid: input.wikidataQid ?? null,
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

// Renames also touch corpus labels and earned mastery keys, so the complete
// update lives in one transaction in the shared corpus/graph write module.
export async function updateKnowledgeNode(
  input: UpdateNodeInput,
  actorUserId: string,
): Promise<NodeResult> {
  const { updateKnowledgeNodeAtomically } = await import('@/server/knowledge/merge-domain');
  return updateKnowledgeNodeAtomically(input, actorUserId);
}

export type EdgeResult =
  | { ok: true; edge: KnowledgeEdgeRow }
  | { ok: false; reason: 'self_edge' | 'unknown_node' | 'duplicate' | 'not_found' };

// Serialize graph writes that can add or reverse links. A single transaction-
// scoped lock is enough for the admin-only editor; the recursive check then
// sees every previously committed edit before it inserts an edge.
const GRAPH_LOCK = [728761, 1];

export async function lockKnowledgeGraph(client: Pick<PoolClient, 'query'>): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', GRAPH_LOCK);
}

// Caller holds GRAPH_LOCK and an open transaction. Edges point child -> parent;
// adding child -> parent loops exactly when parent is already below child.
// UNION (not UNION ALL) also terminates if legacy data already has a cycle.
async function insertKnowledgeEdge(
  client: PoolClient,
  input: { childDomainKey: string; parentDomainKey: string },
): Promise<EdgeResult> {
  if (input.childDomainKey === input.parentDomainKey) {
    return { ok: false, reason: 'self_edge' };
  }

  const nodes = await client.query<{ domain_key: string }>(
    'SELECT domain_key FROM "KnowledgeNode" WHERE domain_key = ANY($1)',
    [[input.childDomainKey, input.parentDomainKey]],
  );
  if (nodes.rows.length !== 2) return { ok: false, reason: 'unknown_node' };

  const cycle = await client.query(
    `WITH RECURSIVE descendants(domain_key) AS (
       SELECT $1::text
       UNION
       SELECT e.child_domain_key FROM "KnowledgeEdge" e
       JOIN descendants d ON e.parent_domain_key = d.domain_key
     ) SELECT 1 FROM descendants WHERE domain_key = $2 LIMIT 1`,
    [input.childDomainKey, input.parentDomainKey],
  );
  if (cycle.rows.length > 0) return { ok: false, reason: 'self_edge' };

  const inserted = await client.query<KnowledgeEdgeRow>(
    `INSERT INTO "KnowledgeEdge" (child_domain_key, parent_domain_key)
     VALUES ($1, $2) ON CONFLICT (child_domain_key, parent_domain_key) DO NOTHING
     RETURNING id, child_domain_key AS "childDomainKey",
       parent_domain_key AS "parentDomainKey", created_at AS "createdAt"`,
    [input.childDomainKey, input.parentDomainKey],
  );
  return inserted.rows[0]
    ? { ok: true, edge: inserted.rows[0] }
    : { ok: false, reason: 'duplicate' };
}

export async function createKnowledgeEdge(
  input: { childDomainKey: string; parentDomainKey: string },
  actorUserId: string,
): Promise<EdgeResult> {
  if (input.childDomainKey === input.parentDomainKey) {
    return { ok: false, reason: 'self_edge' };
  }
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    await lockKnowledgeGraph(client);
    const result = await insertKnowledgeEdge(client, input);
    await client.query(result.ok ? 'COMMIT' : 'ROLLBACK');
    inTransaction = false;
    if (result.ok) console.info('[knowledge-admin] edge created', { actorUserId, ...input });
    return result;
  } finally {
    if (inTransaction) await client.query('ROLLBACK');
    client.release();
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
    /** Present when the proposal came from Wikidata — stored on the parent node for provenance/re-query. */
    wikidataQid?: string | null;
  },
  actorUserId: string,
): Promise<EdgeResult> {
  const parentKey = domainKey(input.parentLabel);

  const [existing] = await db
    .select({ id: knowledgeNodes.id, wikidataQid: knowledgeNodes.wikidataQid })
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.domainKey, parentKey))
    .limit(1);
  if (existing) {
    // The node predates this ratify (manual or LLM-minted) — a Wikidata-backed
    // ratify is the moment we LEARN its QID, so record it. Never overwrite one.
    if (input.wikidataQid && !existing.wikidataQid) {
      await db
        .update(knowledgeNodes)
        .set({ wikidataQid: input.wikidataQid })
        .where(eq(knowledgeNodes.id, existing.id));
    }
  } else {
    const created = await createKnowledgeNode(
      {
        label: input.parentLabel,
        nodeKind: 'parent',
        masteryThreshold: null,
        broadCategory: input.parentBroadCategory,
        fieldHue: null,
        wikidataQid: input.wikidataQid ?? null,
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
    { childDomainKey: input.childDomainKey, parentDomainKey: parentKey },
    actorUserId,
  );
}

// Flip a child above its own parent ("drag Shakespeare so it is the parent of
// Shakespearean Drama"): the child takes the parent's memberships, the parent
// files under the child, everything else stays put. The old link must be
// removed before testing the reverse one; a transaction keeps that sequence
// invisible to other sessions and rolls it back if the new link would loop.
export async function invertKnowledgeEdge(
  input: { childDomainKey: string; parentDomainKey: string },
  actorUserId: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'self_edge' }> {
  if (input.childDomainKey === input.parentDomainKey) return { ok: false, reason: 'self_edge' };
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    await lockKnowledgeGraph(client);
    const edge = await client.query<{ id: string }>(
      `SELECT id FROM "KnowledgeEdge"
       WHERE child_domain_key = $1 AND parent_domain_key = $2 FOR UPDATE`,
      [input.childDomainKey, input.parentDomainKey],
    );
    if (!edge.rows[0]) return { ok: false, reason: 'not_found' };

    const childParents = await client.query<{ parent_domain_key: string }>(
      `SELECT parent_domain_key FROM "KnowledgeEdge" WHERE child_domain_key = $1`,
      [input.childDomainKey],
    );
    const parentParents = await client.query<{ id: string; parent_domain_key: string }>(
      `SELECT id, parent_domain_key FROM "KnowledgeEdge" WHERE child_domain_key = $1`,
      [input.parentDomainKey],
    );
    const childAlreadyUnder = new Set(childParents.rows.map((e) => e.parent_domain_key));
    for (const grand of parentParents.rows) {
      if (childAlreadyUnder.has(grand.parent_domain_key) || grand.parent_domain_key === input.childDomainKey) {
        await client.query(`DELETE FROM "KnowledgeEdge" WHERE id = $1`, [grand.id]);
      } else {
        await client.query(
          `UPDATE "KnowledgeEdge" SET child_domain_key = $2 WHERE id = $1`,
          [grand.id, input.childDomainKey],
        );
      }
    }

    await client.query(`DELETE FROM "KnowledgeEdge" WHERE id = $1`, [edge.rows[0].id]);
    const reversed = await insertKnowledgeEdge(client, {
      childDomainKey: input.parentDomainKey,
      parentDomainKey: input.childDomainKey,
    });
    if (!reversed.ok && reversed.reason !== 'duplicate') {
      return { ok: false, reason: reversed.reason === 'self_edge' ? 'self_edge' : 'not_found' };
    }
    await client.query(
      `UPDATE "KnowledgeNode" SET node_kind = 'both'
       WHERE domain_key = $1 AND node_kind = 'leaf'`,
      [input.childDomainKey],
    );
    await client.query('COMMIT');
    inTransaction = false;
    console.info('[knowledge-admin] edge inverted', { actorUserId, ...input });
    return { ok: true };
  } finally {
    if (inTransaction) await client.query('ROLLBACK');
    client.release();
  }
}

// Tree-editor verb: attach a child under a parent, optionally moving it FROM
// its current parent. Filing under a leaf promotes that leaf to 'both'.
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

  const created = await createKnowledgeEdge(
    {
      childDomainKey: input.childDomainKey,
      parentDomainKey: input.toParentDomainKey,
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
      { childDomainKey: childKey, parentDomainKey: parentKey },
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
