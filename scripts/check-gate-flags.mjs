#!/usr/bin/env node
// PARTIAL_ANSWER_LEAK_ENABLED / DOMAIN_DRIFT_DROP_ENABLED flip check — the
// read behind diagnosis/answer-leak-domain-drift-plan.md's "check back once
// real traffic exists" diagnostic.
//
//   npm run check:gate-flags
//
// Read-only. Reports what GateDropStat actually shows for the two gates
// since Josh flipped both flags on in Vercel production (2026-09-07, ~23:48
// UTC — the deployment that shipped both the 'model'-noun fix and the
// off-domain second opinion). Safe to run any time; no writes, no LLM calls.
//
// WHY THIS EXISTS AS A SCRIPT rather than a one-off SQL query someone re-types
// each time: the interpretation has real gotchas that are easy to get wrong
// under time pressure --
//   - `day` in GateDropStat is a UTC calendar day, and the flip happened late
//     in that day, so 2026-09-07's own row is mostly PRE-flip traffic and
//     must not be read as evidence either way. Only days strictly AFTER the
//     flip date count.
//   - `dropped: 0` on a quiet day is NOT evidence the flag is off. Both gates
//     have low measured hit rates (partial-leak ~0.56%, domain-drift lower
//     still after the second opinion filters it) against ~13-16 rows/day of
//     generation -- several drop-free days in a row is the EXPECTED shape,
//     not a red flag on its own.
//   - domain_drift's own `failed_open` counter is structurally almost always
//     0 even when the underlying LLM call fails -- a Haiku outage on the
//     shared quality-gate call surfaces as `failed_open` on the 'quality'
//     gate, not on 'domain_drift'. Checking 'quality' alongside is what
//     actually tells you whether domain-drift's zero days are "nothing to
//     catch" or "the check silently isn't running."

import 'dotenv/config';
import pg from 'pg';

// UTC calendar day of the flip. Rows on or before this date mix pre- and
// post-flip traffic and are excluded from the verdict.
const FLIP_DAY = '2026-09-07';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

function line(label, value) {
  console.log(`  ${label.padEnd(28)} ${value}`);
}

try {
  const { rows } = await pool.query(
    `select day, gate, considered, dropped, failed_open
       from "GateDropStat"
      where gate in ('answer_leak_partial', 'domain_drift', 'quality')
      order by day asc, gate asc`,
  );

  console.log(`\n=== Gate-flag check (flip day: ${FLIP_DAY}) ===\n`);

  // `day` comes back from `pg` as a JS Date (UTC midnight), not a string.
  // Comparing a Date to FLIP_DAY with `<=`/`>` coerces the Date via its
  // *local-timezone* toString(), not an ISO date string, so the comparison
  // silently does the wrong thing instead of throwing. Normalize to a plain
  // 'YYYY-MM-DD' UTC string first, which sorts identically to a real date
  // compare and matches FLIP_DAY's own format.
  const dayStr = (r) => (r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day));

  const byGate = (gate) => rows.filter((r) => r.gate === gate);
  const preFlip = (r) => dayStr(r) <= FLIP_DAY;
  const postFlip = (r) => dayStr(r) > FLIP_DAY;

  for (const gate of ['answer_leak_partial', 'domain_drift']) {
    const gateRows = byGate(gate);
    const pre = gateRows.filter(preFlip);
    const post = gateRows.filter(postFlip);

    console.log(`--- ${gate} ---`);
    if (pre.length > 0) {
      const preConsidered = pre.reduce((s, r) => s + r.considered, 0);
      const preDropped = pre.reduce((s, r) => s + r.dropped, 0);
      line('pre-flip (measure-only)', `${preDropped} dropped / ${preConsidered} considered -- expected 0, this was shadow mode`);
    }
    if (post.length === 0) {
      line('post-flip data', 'NONE YET -- no generation has run since the flip. Check back later.');
      console.log('');
      continue;
    }
    const postConsidered = post.reduce((s, r) => s + r.considered, 0);
    const postDropped = post.reduce((s, r) => s + r.dropped, 0);
    const rate = postConsidered > 0 ? ((postDropped / postConsidered) * 100).toFixed(2) : '0.00';
    line('post-flip days', post.map(dayStr).join(', '));
    line('post-flip totals', `${postDropped} dropped / ${postConsidered} considered (${rate}%)`);
    for (const r of post) {
      console.log(`    ${dayStr(r)}  considered=${r.considered}  dropped=${r.dropped}  failed_open=${r.failed_open}`);
    }
    if (postDropped > 0) {
      console.log(`  [EVIDENCE] The flag is doing something -- at least one real drop since the flip.`);
    } else {
      console.log(`  [INCONCLUSIVE] Zero drops so far. At this gate's measured rate this is NOT`);
      console.log(`  unusual after only a few days -- keep checking rather than concluding "off."`);
    }
    console.log('');
  }

  // Shared upstream health: if the 'quality' gate (the Haiku call domain_drift
  // rides on) is failing open a lot post-flip, domain_drift's zero-drop days
  // may mean "the check isn't running," not "nothing to catch."
  const qualityPost = byGate('quality').filter(postFlip);
  if (qualityPost.length > 0) {
    const failedOpen = qualityPost.reduce((s, r) => s + r.failed_open, 0);
    console.log('--- quality gate health (shared plumbing under domain_drift) ---');
    line('post-flip failed_open runs', String(failedOpen));
    if (failedOpen > 0) {
      console.log(`  [CHECK] Non-zero failed-open runs on the shared LLM call -- some of`);
      console.log(`  domain_drift's zero-drop days may be "didn't run" rather than "nothing found."`);
    } else {
      console.log(`  [OK] No failed-open runs -- domain_drift's zero-drop days (if any) are`);
      console.log(`  genuinely "nothing to catch," not a silent outage.`);
    }
    console.log('');
  }

  console.log('Reminder: this checks PRODUCTION traffic via the shared DB. It cannot see');
  console.log('the actual Vercel env var values from this machine -- it only sees their EFFECT.\n');
} catch (err) {
  console.error('\ncheck-gate-flags failed:', err.message);
  console.error('(needs DATABASE_URL in .env; read-only, safe to retry)\n');
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
