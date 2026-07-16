import 'dotenv/config';

import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';

import { db, pool, generatedQuestions } from '../src/server/db';
import { runWithConcurrency } from '../src/server/lib/concurrency';
import { prefilterForVerification } from '../src/server/quality/verification-prefilter';
import {
  verdictToGeneratedPatch,
  verifyQuestion,
} from '../src/server/quality/verify-question';
import {
  isSalvageGeneratedOnDemoteEnabled,
  salvageOrSuppressGeneratedDemote,
  type GeneratedDemoteRow,
} from '../src/server/quality/salvage-generated';

// One-time backlog verify over EVERY uncovered generated row (verified_at IS
// NULL, not suppressed). Deliberately IGNORES the cron's `expires_at > now`
// filter so the cron-blind past-expiry rows (which still serve — serving is
// durable) are finally covered. Same prefilter -> verify -> salvage-or-suppress
// path the cron uses, so behavior is identical; this just clears the backlog in
// one paced pass instead of trickling ~35/day.
//
//   npx tsx scripts/backfill-verify-generated.ts            # DRY RUN (no writes)
//   npx tsx scripts/backfill-verify-generated.ts --apply    # writes to prod
//
// Concurrency kept low (rate limits: a sequential 60-row probe still hit ~17%
// verifier nulls). Nulls are fail-open — the row is left unstamped and simply
// re-picked on a later run, never wrongly demoted.
const APPLY = process.argv.includes('--apply');
const CONCURRENCY = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY ?? 3));
const LIMIT = Number(process.env.BACKFILL_LIMIT ?? 0); // 0 = no cap

async function verifyWithRetry(input: Parameters<typeof verifyQuestion>[0]) {
  const first = await verifyQuestion(input);
  if (first) return first;
  return verifyQuestion(input); // one retry — nulls are usually transient rate limits
}

async function main() {
  const rows = (await db
    .select({
      id: generatedQuestions.id,
      questionText: generatedQuestions.questionText,
      answer: generatedQuestions.answer,
      explanation: generatedQuestions.explainer,
      canonicalSubcategory: generatedQuestions.canonicalSubcategory,
      broadCategory: generatedQuestions.broadCategory,
    })
    .from(generatedQuestions)
    .where(and(
      isNull(generatedQuestions.verifiedAt),
      eq(generatedQuestions.isDuplicate, false),
      isNotNull(generatedQuestions.factKey),
    ))
    .orderBy(sql`${generatedQuestions.createdAt} desc`)
    .limit(LIMIT > 0 ? LIMIT : 1_000_000)) as GeneratedDemoteRow[];

  const tally = { scanned: rows.length, skipped: 0, ok: 0, unverifiable: 0, salvaged: 0, suppressed: 0, failed: 0 };
  const now = new Date();
  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${rows.length} uncovered generated rows; salvage=${isSalvageGeneratedOnDemoteEnabled()}, concurrency=${CONCURRENCY}\n`);

  await runWithConcurrency(rows, CONCURRENCY, async (row) => {
    try {
      const decision = prefilterForVerification({
        questionText: row.questionText,
        answer: row.answer,
        explanation: row.explanation,
        canonicalSubcategory: row.canonicalSubcategory,
      });
      if (!decision.needsVerification) {
        if (APPLY) await db.update(generatedQuestions).set(verdictToGeneratedPatch('skipped', now)).where(eq(generatedQuestions.id, row.id));
        tally.skipped += 1;
        return;
      }
      const result = await verifyWithRetry({
        questionText: row.questionText,
        answer: row.answer,
        explanation: row.explanation,
        canonicalSubcategory: row.canonicalSubcategory,
        broadCategory: row.broadCategory,
        dimensions: decision.dimensions,
      });
      if (!result) { tally.failed += 1; return; } // fail-open, unstamped

      if (result.outcome === 'demoted') {
        const res = await salvageOrSuppressGeneratedDemote(row, result.reason, now, { persist: APPLY });
        if (res.action === 'salvaged') { tally.salvaged += 1; console.log(`  SALVAGED  ${row.id}  ${res.note}`); }
        else { tally.suppressed += 1; console.log(`  SUPPRESS  ${row.id}  ${res.note}`); }
        return;
      }
      if (APPLY) await db.update(generatedQuestions).set(verdictToGeneratedPatch(result.outcome, now, result.reason)).where(eq(generatedQuestions.id, row.id));
      tally[result.outcome] += 1;
    } catch (error) {
      tally.failed += 1;
      console.warn(`  ERROR     ${row.id}  ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  console.log(`\n===== ${APPLY ? 'APPLIED' : 'DRY-RUN'} TALLY =====`);
  console.log(tally);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
