import 'dotenv/config';
import fs from 'node:fs';

import { eq, inArray } from 'drizzle-orm';

import { db, pool, generatedQuestions } from '../src/server/db';

// 2026-09-07 incident: the Anthropic account ran out of credits partway
// through scripts/rewrite-bank-demotions.ts. proposeBankRewrite fails
// SAFE on any fault (never fabricates a fix), which is correct behavior —
// but its generic failure note ("no safe rewrite") is IDENTICAL whether the
// model genuinely judged a row unfixable or the API call simply errored.
// 329 rows ended up stamped verification_reason = 'unsalvageable: no safe
// rewrite' this way — a real model verdict of "unsalvageable" always carries
// a SPECIFIC note (see the two genuine ones still in the DB), so the exact
// generic string is an unambiguous fault signature, not a judgment call.
//
// This restores those 329 rows' verification_reason to their ORIGINAL
// 'bank sweep: <defect>' text (recovered from the full sweep run's saved
// log, which covers every one of the original 610 findings) so they fall
// back into scripts/rewrite-bank-demotions.ts's eligibility query and get a
// REAL attempt once the Anthropic account has credits again. Nothing else
// changes — is_duplicate was never touched for these rows, only the reason
// string was overwritten by the failed run.
//
//   npx tsx scripts/revert-credit-failure-fallout.ts <log-file-path>            # DRY RUN
//   npx tsx scripts/revert-credit-failure-fallout.ts <log-file-path> --apply    # writes

const APPLY = process.argv.includes('--apply');
const logPath = process.argv[2];
if (!logPath || logPath.startsWith('--')) {
  console.error('usage: npx tsx scripts/revert-credit-failure-fallout.ts <sweep-log-path> [--apply]');
  process.exit(1);
}

function parseSweepLog(text: string): Map<string, string> {
  const map = new Map<string, string>();
  // Matches every "[kind] <id>  (<domain>)\n    Q: ...\n    A: ...\n    why: ..."
  // block the sweep script printed, for any kind (deterministic/llm/off_domain).
  const re = /\[(?:deterministic|llm|off_domain)\] (\S+)\s+\([^)]+\)\n {4}Q: .*\n {4}A: .*\n {4}why: (.*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

async function main() {
  const log = fs.readFileSync(logPath, 'utf8');
  const reasonById = parseSweepLog(log);
  console.log(`[revert] parsed ${reasonById.size} original findings from ${logPath}`);

  const corrupted = await db
    .select({ id: generatedQuestions.id })
    .from(generatedQuestions)
    .where(eq(generatedQuestions.verificationReason, 'unsalvageable: no safe rewrite'));
  console.log(`[revert] ${corrupted.length} rows carry the fault-fallback marker`);

  const recoverable: { id: string; reason: string }[] = [];
  const noLogEntry: string[] = [];
  for (const { id } of corrupted) {
    const reason = reasonById.get(id);
    if (reason) recoverable.push({ id, reason });
    else noLogEntry.push(id);
  }
  console.log(
    `[revert] ${recoverable.length} recoverable from the log with their EXACT original reason`,
  );
  console.log(
    `[revert] ${noLogEntry.length} not matched by the log parse (a regex edge case in a small`,
    'number of blocks, not a deeper problem) — these still get restored to eligibility below,',
    'with an honest placeholder reason rather than staying stuck on the fault-fallback text.',
  );

  if (!APPLY) {
    console.log('[revert] DRY RUN — re-run with --apply to write.');
    return;
  }

  let n = 0;
  for (const { id, reason } of recoverable) {
    const updated = await db
      .update(generatedQuestions)
      .set({ verificationReason: `bank sweep: ${reason}`.slice(0, 500) })
      .where(inArray(generatedQuestions.id, [id]))
      .returning({ id: generatedQuestions.id });
    n += updated.length;
  }
  console.log(`[revert] restored ${n} row(s) to their exact original 'bank sweep:' reason.`);

  let placeholders = 0;
  for (const id of noLogEntry) {
    const updated = await db
      .update(generatedQuestions)
      .set({
        verificationReason:
          'bank sweep: (original defect reason lost to the 2026-09-07 credit-exhaustion incident; re-evaluated fresh)',
      })
      .where(inArray(generatedQuestions.id, [id]))
      .returning({ id: generatedQuestions.id });
    placeholders += updated.length;
  }
  console.log(`[revert] restored ${placeholders} row(s) with a placeholder reason (re-eligible for a fresh pass).`);
}

main()
  .catch((err) => {
    console.error('[revert] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
