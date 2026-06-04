// Batched backfill: populate GeneratedQuestion.embedding / Question.embedding
// (Voyage voyage-3.5-lite, 1024-dim) for the existing pool, then run the
// embedding-dedup collision pass over the back-filled rows.
//
// APPROVAL GATE (PRD-D-5 §8 B1): run the dry-run first — it reports how many
// rows need embedding and the estimated Voyage cost. Do not --apply until that
// estimate is approved.
//
// Idempotent: only rows with a NULL embedding are processed; re-running resumes.
// Requires VOYAGE_API_KEY in the environment.
//
// Usage:
//   npx tsx scripts/backfill-pool-embeddings.ts            # dry-run (count + cost)
//   npx tsx scripts/backfill-pool-embeddings.ts --apply    # embed + dedup

import 'dotenv/config';

import { eq, isNull, isNotNull, and } from 'drizzle-orm';

import { db, pool, generatedQuestions, questions } from '../src/server/db';
import { embedTexts, EMBEDDING_BATCH_SIZE, isEmbeddingEnabled } from '../src/server/llm/embeddings';
import {
  findNearestInPool,
  markPoolDuplicate,
  storePoolEmbedding,
  type PoolOrigin,
} from '../src/server/db/queries/pool';
import { resolveCollision, getDedupCosineThreshold } from '../src/server/pool/dedup';

const APPLY = process.argv.slice(2).includes('--apply');

// voyage-3.5-lite list price (USD per 1M tokens). Adjust if Voyage repricing.
const VOYAGE_PRICE_PER_MTOK = 0.02;
// Cheap token proxy: ~4 chars/token.
const estimateTokens = (text: string) => Math.ceil((text?.length ?? 0) / 4);

type Pending = { id: string; text: string; origin: PoolOrigin };

async function loadPending(): Promise<Pending[]> {
  const [machine, human] = await Promise.all([
    db
      .select({ id: generatedQuestions.id, text: generatedQuestions.questionText })
      .from(generatedQuestions)
      .where(isNull(generatedQuestions.embedding)),
    db
      .select({ id: questions.id, text: questions.questionText })
      .from(questions)
      .where(and(isNull(questions.embedding), isNull(questions.deletedAt))),
  ]);
  return [
    ...machine.map((r) => ({ id: r.id, text: r.text, origin: 'machine' as const })),
    ...human.map((r) => ({ id: r.id, text: r.text, origin: 'human' as const })),
  ];
}

async function main() {
  console.log(`[backfill-pool-embeddings] ${APPLY ? 'APPLY' : 'DRY RUN'} mode\n`);

  const pending = await loadPending();
  const machineCount = pending.filter((p) => p.origin === 'machine').length;
  const humanCount = pending.length - machineCount;
  const totalTokens = pending.reduce((sum, p) => sum + estimateTokens(p.text), 0);
  const estCost = (totalTokens / 1_000_000) * VOYAGE_PRICE_PER_MTOK;

  console.log(`[backfill-pool-embeddings] rows needing embedding: ${pending.length} (machine=${machineCount}, human=${humanCount})`);
  console.log(`[backfill-pool-embeddings] est. tokens: ~${totalTokens.toLocaleString()} → est. Voyage cost: ~$${estCost.toFixed(4)} (at $${VOYAGE_PRICE_PER_MTOK}/1M tok)`);
  console.log(`[backfill-pool-embeddings] dedup cosine threshold: ${getDedupCosineThreshold()}`);

  // Sanity check: confirm pgvector + embedding columns are actually present.
  const haveColumns = await db
    .select({ id: generatedQuestions.id })
    .from(generatedQuestions)
    .where(isNotNull(generatedQuestions.embedding))
    .limit(1)
    .then(() => true)
    .catch((err) => {
      console.warn('[backfill-pool-embeddings] embedding column not queryable yet — run migration 0063 first', { message: String(err) });
      return false;
    });
  if (!haveColumns) return;

  if (!APPLY) {
    console.log('\n[backfill-pool-embeddings] dry run only — re-run with --apply once the cost is approved.');
    return;
  }
  if (!isEmbeddingEnabled()) {
    console.error('[backfill-pool-embeddings] VOYAGE_API_KEY missing — cannot --apply.');
    process.exitCode = 1;
    return;
  }

  // 1) Embed + store in batches.
  let embedded = 0;
  for (let start = 0; start < pending.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = pending.slice(start, start + EMBEDDING_BATCH_SIZE);
    const vectors = await embedTexts(batch.map((b) => b.text), 'document');
    if (!vectors) {
      console.error('[backfill-pool-embeddings] embedding disabled mid-run; stopping.');
      break;
    }
    for (let i = 0; i < batch.length; i += 1) {
      const vec = vectors[i];
      if (!vec) continue;
      await storePoolEmbedding(batch[i].origin, batch[i].id, vec);
      embedded += 1;
    }
    console.log(`[backfill-pool-embeddings] embedded ${Math.min(start + batch.length, pending.length)}/${pending.length}`);
  }

  // 2) Collision pass over the freshly back-filled rows. resolveCollision is
  //    direction-aware (human beats machine) regardless of processing order;
  //    findNearestInPool already excludes already-suppressed rows.
  let suppressed = 0;
  for (const row of pending) {
    const [stored] = await db
      .select({ embedding: row.origin === 'machine' ? generatedQuestions.embedding : questions.embedding })
      .from(row.origin === 'machine' ? generatedQuestions : questions)
      .where(eq(row.origin === 'machine' ? generatedQuestions.id : questions.id, row.id))
      .limit(1);
    const embedding = stored?.embedding as number[] | null | undefined;
    if (!embedding) continue;
    const nearest = await findNearestInPool(embedding, row.id);
    const decision = resolveCollision({ id: row.id, origin: row.origin }, nearest, getDedupCosineThreshold());
    if (decision.action === 'suppress_incoming') {
      await markPoolDuplicate(row.origin, row.id, decision.survivorId);
      suppressed += 1;
    } else if (decision.action === 'suppress_existing') {
      await markPoolDuplicate(decision.existingOrigin, decision.existingId, decision.survivorId);
      suppressed += 1;
    }
  }

  console.log(`\n[backfill-pool-embeddings] done. embedded=${embedded}, suppressed=${suppressed}`);
}

main()
  .catch((err) => {
    console.error('[backfill-pool-embeddings] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
