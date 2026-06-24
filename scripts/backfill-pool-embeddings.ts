// Batched backfill: populate GeneratedQuestion.embedding / Question.embedding
// (Voyage voyage-3.5-lite, 1024-dim) for the existing pool, then run the
// embedding-dedup collision pass over the back-filled rows.
//
// Two steps, cheapest first:
//   0) FREE copy-from-twin. daily_generated canonical promotions before
//      2026-06-21 (commit 51bf2d6d, which added the embedding copy line) never
//      copied their GeneratedQuestion twin's embedding — orphaning ~70 canonical
//      rows whose embedding already exists one join away. Copy it across; no
//      Voyage call. This is what makes those rows visible to the per-user
//      answered-history dedup gate again (B-DEDUP-SEMANTIC-01).
//   1) Voyage-embed whatever is still NULL (rows where the twin was also never
//      embedded — typically transient Voyage failures at generation time), then
//      run the collision pass.
//
// APPROVAL GATE (PRD-D-5 §8 B1): run the dry-run first — it reports how many
// rows copy for free, how many still need Voyage, and the estimated cost. Do
// not --apply until that estimate is approved.
//
// Idempotent: only rows with a NULL embedding are processed; re-running resumes.
// The --apply path requires VOYAGE_API_KEY in the environment. Secrets live in
// .env.local here, so run with: npx tsx -r dotenv/config scripts/backfill-pool-embeddings.ts --apply dotenv_config_path=.env.local
//
// Usage:
//   npx tsx scripts/backfill-pool-embeddings.ts            # dry-run (count + cost)
//   npx tsx scripts/backfill-pool-embeddings.ts --apply    # copy + embed + dedup

import 'dotenv/config';

import { eq, isNull, isNotNull, and, sql } from 'drizzle-orm';

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

// How many canonical rows can be filled FREE from their generated twin.
async function countCopyableFromTwins(): Promise<number> {
  const res = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM "Question" q
    JOIN "GeneratedQuestion" g ON g.id = q.generated_question_id
    WHERE q.embedding IS NULL AND g.embedding IS NOT NULL AND q.deleted_at IS NULL
  `);
  return Number((res.rows[0] as { n: number } | undefined)?.n ?? 0);
}

// Copy each null canonical row's embedding from its already-embedded twin.
async function copyEmbeddingsFromTwins(): Promise<number> {
  const res = await db.execute(sql`
    UPDATE "Question" q
    SET embedding = g.embedding
    FROM "GeneratedQuestion" g
    WHERE q.generated_question_id = g.id
      AND q.embedding IS NULL AND g.embedding IS NOT NULL AND q.deleted_at IS NULL
  `);
  return res.rowCount ?? 0;
}

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

  // Step 0: FREE copy-from-twin (no Voyage cost).
  const copyable = await countCopyableFromTwins();
  console.log(`[backfill-pool-embeddings] canonical rows backfillable FREE from generated twin: ${copyable}`);
  if (APPLY && copyable > 0) {
    const copied = await copyEmbeddingsFromTwins();
    console.log(`[backfill-pool-embeddings] copied ${copied} embeddings from twins (no Voyage cost)`);
  }

  // Step 1: whatever is still NULL needs a Voyage call. In APPLY mode the copy
  // above already ran, so these are the genuinely-both-null rows; in dry-run the
  // copy hasn't run, so subtract `copyable` to estimate the real Voyage volume.
  const pending = await loadPending();
  const machineCount = pending.filter((p) => p.origin === 'machine').length;
  const humanCount = pending.length - machineCount;
  const voyageNeeded = APPLY ? pending.length : Math.max(0, pending.length - copyable);
  const totalTokens = pending.reduce((sum, p) => sum + estimateTokens(p.text), 0);
  const estCost = (totalTokens / 1_000_000) * VOYAGE_PRICE_PER_MTOK;

  console.log(`[backfill-pool-embeddings] rows still NULL after copy: ${pending.length} (machine=${machineCount}, human=${humanCount})`);
  console.log(`[backfill-pool-embeddings] est. rows needing Voyage: ~${voyageNeeded}`);
  console.log(`[backfill-pool-embeddings] est. tokens: ~${totalTokens.toLocaleString()} → est. Voyage cost: ~$${estCost.toFixed(4)} (at $${VOYAGE_PRICE_PER_MTOK}/1M tok)`);
  console.log(`[backfill-pool-embeddings] dedup cosine threshold: ${getDedupCosineThreshold()}`);

  if (!APPLY) {
    console.log('\n[backfill-pool-embeddings] dry run only — re-run with --apply once the cost is approved.');
    return;
  }
  if (!isEmbeddingEnabled()) {
    console.error('[backfill-pool-embeddings] VOYAGE_API_KEY missing — cannot --apply.');
    process.exitCode = 1;
    return;
  }

  // 2) Embed + store in batches.
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

  // 3) Collision pass over the freshly back-filled rows. resolveCollision is
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

  console.log(`\n[backfill-pool-embeddings] done. copied_from_twin=${copyable}, embedded=${embedded}, suppressed=${suppressed}`);
}

main()
  .catch((err) => {
    console.error('[backfill-pool-embeddings] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
