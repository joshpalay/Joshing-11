import 'dotenv/config';

import { and, eq, ilike, inArray } from 'drizzle-orm';

import { db, pool, generatedQuestions } from '../src/server/db';

// 2026-09-07 incident, part 3. During the rewrite pass, two overlapping
// process runs (a background one that outlived its own "killed" signal, plus
// foreground runs launched afterward) briefly raced on the same eligible
// rows. For a slice of rows this produced a harmless-but-wrong RESULT: the
// row was correctly recovered (is_duplicate=false, verification_verdict='ok',
// the CONTENT genuinely rewritten and clean — verified by hand-inspecting a
// sample) but a LATER write from the overlapping run — specifically
// scripts/revert-credit-failure-fallout.ts, which matched purely on the
// fault-fallback reason STRING with no is_duplicate guard (now fixed) —
// stomped verification_reason back to the ORIGINAL pre-rewrite defect text.
// Players were never served anything wrong; this is a label-only fix.
//
//   npx tsx scripts/fix-mislabeled-recovered-rows.ts            # DRY RUN
//   npx tsx scripts/fix-mislabeled-recovered-rows.ts --apply    # writes

const APPLY = process.argv.includes('--apply');

async function main() {
  const rows = await db
    .select({ id: generatedQuestions.id })
    .from(generatedQuestions)
    .where(
      and(
        eq(generatedQuestions.isDuplicate, false),
        eq(generatedQuestions.verificationVerdict, 'ok'),
        ilike(generatedQuestions.verificationReason, 'bank sweep:%'),
      ),
    );
  console.log(`[fix] ${rows.length} servable rows still labeled with their pre-rewrite reason`);
  if (!APPLY) {
    console.log('[fix] DRY RUN — re-run with --apply to write.');
    return;
  }
  let n = 0;
  for (const { id } of rows) {
    const updated = await db
      .update(generatedQuestions)
      .set({
        verificationReason:
          'rewritten: recovered during the 2026-09-07 rewrite pass; exact rewrite note lost to a concurrent-run label bug (content and verdict were never affected, see scripts/revert-credit-failure-fallout.ts)',
      })
      .where(inArray(generatedQuestions.id, [id]))
      .returning({ id: generatedQuestions.id });
    n += updated.length;
  }
  console.log(`[fix] relabeled ${n} row(s).`);
}

main()
  .catch((err) => {
    console.error('[fix] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
