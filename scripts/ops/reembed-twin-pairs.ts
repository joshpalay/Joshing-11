// Refresh Voyage embeddings so they match each twin pair's CURRENT question text.
//
// WHY: the reconcile-twin-drift pass (B-TWIN-DRIFT-01) converged 83 drifted
// Question⇄GeneratedQuestion pairs onto their canonical copy, changing served
// text. But both rows in a pair share ONE embedding vector, copied at twin-
// creation from the ORIGINAL GeneratedQuestion text and never recomputed when the
// text was later edited. So after convergence some rows' stored embedding encodes
// stale text. Embeddings power the semantic-dedup backstop (pool.ts / dedup.ts),
// so a stale vector can mis-judge a new row against these.
//
// WHAT: for every live twin pair (Question with a generated_question_id + its
// GeneratedQuestion), embed the CURRENT question_text once and write that vector
// to BOTH rows. Voyage is deterministic, so unchanged rows get an identical vector
// (a no-op) and only the genuinely-stale rows actually change — the net effect is
// exactly "fix the stale ones," with no need to enumerate them.
//
// SCOPE / SAFETY: this ONLY overwrites the `embedding` column. Unlike
// backfill-pool-embeddings.ts it runs NO collision pass — is_duplicate / suppressed_by
// are left untouched, so re-embedding cannot change what is served or suppressed.
// Idempotent: safe to re-run.
//
// Secrets live in .env.local here. Run:
//   npx tsx scripts/ops/reembed-twin-pairs.ts                                        # DRY RUN (count + cost)
//   npx tsx -r dotenv/config scripts/ops/reembed-twin-pairs.ts --apply dotenv_config_path=.env.local

import 'dotenv/config';

import { eq, isNull, isNotNull, and } from 'drizzle-orm';

import { db, pool, generatedQuestions, questions } from '../../src/server/db';
import { embedTexts, EMBEDDING_BATCH_SIZE, isEmbeddingEnabled } from '../../src/server/llm/embeddings';

const APPLY = process.argv.slice(2).includes('--apply');

// voyage-3.5-lite list price (USD per 1M tokens); ~4 chars/token proxy.
const VOYAGE_PRICE_PER_MTOK = 0.02;
const estimateTokens = (text: string) => Math.ceil((text?.length ?? 0) / 4);

type Pair = { qId: string; gId: string; text: string };

// Every live twin pair, keyed on the current (post-convergence) Question text —
// the served copy of record.
async function loadPairs(): Promise<Pair[]> {
  const rows = await db
    .select({
      qId: questions.id,
      gId: questions.generatedQuestionId,
      text: questions.questionText,
    })
    .from(questions)
    .where(and(isNotNull(questions.generatedQuestionId), isNull(questions.deletedAt)));
  return rows
    .filter((r): r is Pair => Boolean(r.gId) && Boolean(r.text?.trim()))
    .map((r) => ({ qId: r.qId, gId: r.gId as string, text: r.text }));
}

async function main() {
  console.log(`[reembed-twin-pairs] ${APPLY ? 'APPLY' : 'DRY RUN'} mode\n`);

  const pairs = await loadPairs();
  const totalTokens = pairs.reduce((sum, p) => sum + estimateTokens(p.text), 0);
  const estCost = (totalTokens / 1_000_000) * VOYAGE_PRICE_PER_MTOK;
  console.log(`[reembed-twin-pairs] live twin pairs: ${pairs.length}`);
  console.log(`[reembed-twin-pairs] est. tokens: ~${totalTokens.toLocaleString()} → est. Voyage cost: ~$${estCost.toFixed(4)}`);

  if (!APPLY) {
    console.log('\n[reembed-twin-pairs] dry run only — re-run with --apply (needs VOYAGE_API_KEY).');
    return;
  }
  if (!isEmbeddingEnabled()) {
    console.error('[reembed-twin-pairs] VOYAGE_API_KEY missing — cannot --apply. Use -r dotenv/config dotenv_config_path=.env.local');
    process.exitCode = 1;
    return;
  }

  let updated = 0;
  for (let start = 0; start < pairs.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = pairs.slice(start, start + EMBEDDING_BATCH_SIZE);
    const vectors = await embedTexts(batch.map((b) => b.text), 'document');
    if (!vectors) {
      console.error('[reembed-twin-pairs] embedding disabled mid-run; stopping.');
      break;
    }
    for (let i = 0; i < batch.length; i += 1) {
      const vec = vectors[i];
      if (!vec) continue;
      // Same vector to both stores — they share the pair's single canonical text.
      await db.update(generatedQuestions).set({ embedding: vec }).where(eq(generatedQuestions.id, batch[i].gId));
      await db.update(questions).set({ embedding: vec }).where(eq(questions.id, batch[i].qId));
      updated += 1;
    }
    console.log(`[reembed-twin-pairs] refreshed ${Math.min(start + batch.length, pairs.length)}/${pairs.length}`);
  }

  console.log(`\n[reembed-twin-pairs] done. pairs refreshed=${updated}`);
}

main()
  .catch((err) => {
    console.error('[reembed-twin-pairs] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
