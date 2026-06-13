// One-off backfill: fold existing GeneratedQuestion.broad_category and
// Question.broad_category to their canonical form (Change 3). Idempotent — only
// rows whose label actually changes are touched; re-running is a no-op.
//
// Usage:
//   npx tsx scripts/normalize-broad-category.ts          # dry-run (what would change)
//   npx tsx scripts/normalize-broad-category.ts --apply   # write the folds
import 'dotenv/config';

import { eq } from 'drizzle-orm';

import { db, pool, generatedQuestions, questions } from '../src/server/db';
import { normalizeBroadCategory } from '../src/server/questions/broad-category';

const APPLY = process.argv.slice(2).includes('--apply');

type TableName = 'GeneratedQuestion' | 'Question';

async function foldTable(
  name: TableName,
  table: typeof generatedQuestions | typeof questions,
): Promise<void> {
  const rows = await db
    .select({ broadCategory: table.broadCategory })
    .from(table);

  // Distinct label → normalized label, only where they differ.
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.broadCategory) continue;
    counts.set(row.broadCategory, (counts.get(row.broadCategory) ?? 0) + 1);
  }

  const changes: Array<{ from: string; to: string; n: number }> = [];
  for (const [label, n] of counts) {
    const normalized = normalizeBroadCategory(label);
    if (normalized !== label) changes.push({ from: label, to: normalized, n });
  }
  changes.sort((a, b) => b.n - a.n);

  console.log(`\n[${name}] ${changes.length} label(s) would fold (${changes.reduce((s, c) => s + c.n, 0)} rows):`);
  for (const c of changes) {
    console.log(`  "${c.from}" → "${c.to}"  (${c.n} rows)`);
  }

  if (APPLY) {
    for (const c of changes) {
      await db.update(table).set({ broadCategory: c.to }).where(eq(table.broadCategory, c.from));
    }
    console.log(`[${name}] applied ${changes.length} fold(s).`);
  }
}

async function main() {
  console.log(`[normalize-broad-category] ${APPLY ? 'APPLY' : 'DRY RUN'} mode`);
  await foldTable('GeneratedQuestion', generatedQuestions);
  await foldTable('Question', questions);
  if (!APPLY) console.log('\n[normalize-broad-category] dry run only — re-run with --apply to write.');
}

main()
  .catch((err) => {
    console.error('[normalize-broad-category] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
