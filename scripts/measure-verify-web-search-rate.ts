/**
 * Before/after measurement for the verify-question.ts "knowledge-first" system
 * prompt tightening (2026-07-17, see src/server/quality/verify-question.ts —
 * the SYSTEM_PROMPT "Method" section) — does the model actually call
 * web_search less often / burn fewer input tokens per call after the change?
 *
 * Unlike measure-prefilter-skip-rate.ts, the pre-filter is a pure function that
 * can be replayed offline on old rows; the search decision here is made by the
 * LLM itself mid-call, so there's nothing to replay. Instead this reads the
 * LlmUsageEvent ledger (scope='batch-verify'), which already records per-call
 * webSearchRequests + tokens (migration 0105 closed this exact telemetry gap —
 * see docs/findings/ledger-telemetry-gaps.md), and splits the numbers at a
 * cutover timestamp so you can compare the days before the prompt change to the
 * days after it went live.
 *
 * Read-only. Nothing is written.
 *
 * Baseline to beat (docs/findings/batch-verify-cost-characterization.md,
 * measured 2026-07-01): ~11.3k avg input tokens/call — read as "frequent
 * web_search" from token volume alone, since usedWeb wasn't persisted yet at
 * the time. This script gives the direct per-call search-invocation rate that
 * doc was missing.
 *
 *   npx tsx scripts/measure-verify-web-search-rate.ts                     # whole ledger, one table
 *   npx tsx scripts/measure-verify-web-search-rate.ts --since 2026-07-18  # before/after split at that date
 *   npx tsx scripts/measure-verify-web-search-rate.ts --days 30           # limit lookback window
 */
import 'dotenv/config';

import { and, asc, eq, gte } from 'drizzle-orm';

import { db, llmUsageEvent, pool } from '../src/server/db';
import { estimateCostUsd } from '../src/server/llm/pricing';

type Bucket = {
  calls: number;
  callsWithSearch: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  webSearchRequests: number;
  usd: number;
  unpriced: number;
};

function emptyBucket(): Bucket {
  return {
    calls: 0,
    callsWithSearch: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    webSearchRequests: 0,
    usd: 0,
    unpriced: 0,
  };
}

function addRow(b: Bucket, row: {
  model: string;
  isBatch: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  webSearchRequests: number;
}): void {
  b.calls += 1;
  if (row.webSearchRequests > 0) b.callsWithSearch += 1;
  b.inputTokens += row.inputTokens;
  b.outputTokens += row.outputTokens;
  b.cacheReadTokens += row.cacheReadTokens;
  b.cacheCreateTokens += row.cacheCreateTokens;
  b.webSearchRequests += row.webSearchRequests;
  const cost = estimateCostUsd(row.model, {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreateTokens: row.cacheCreateTokens,
    webSearchRequests: row.webSearchRequests,
    isBatch: row.isBatch,
  });
  if (cost.unpriced) b.unpriced += 1;
  else b.usd += cost.usd ?? 0;
}

function fmtPct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;
}

function fmtAvg(total: number, calls: number): string {
  return calls === 0 ? '—' : (total / calls).toFixed(0);
}

// web_search_requests/call is usually well under 1 (most calls search zero
// times) — toFixed(0) would round almost every day to "0" and hide the signal.
function fmtAvgSearch(total: number, calls: number): string {
  return calls === 0 ? '—' : (total / calls).toFixed(2);
}

function printBucket(label: string, b: Bucket): void {
  console.log(`\n${label}`);
  console.log(`  calls:                 ${b.calls}`);
  console.log(`  calls that searched:   ${b.callsWithSearch} (${fmtPct(b.callsWithSearch, b.calls)})`);
  console.log(`  avg web_search/call:   ${fmtAvgSearch(b.webSearchRequests, b.calls)}`);
  console.log(`  avg input tokens/call: ${fmtAvg(b.inputTokens, b.calls)}`);
  console.log(`  avg output tokens/call:${fmtAvg(b.outputTokens, b.calls)}`);
  console.log(`  est. $ (token+search): $${b.usd.toFixed(2)}${b.unpriced > 0 ? `  (${b.unpriced} calls unpriced, excluded)` : ''}`);
}

async function main() {
  const args = process.argv.slice(2);
  const sinceIdx = args.indexOf('--since');
  const sinceArg = sinceIdx >= 0 ? args[sinceIdx + 1] : undefined;
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? Math.max(1, Number(args[daysIdx + 1])) : 30;

  const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const cutover = sinceArg ? new Date(sinceArg) : null;
  if (sinceArg && Number.isNaN(cutover?.getTime())) {
    console.error(`Bad --since date: ${sinceArg} (expected e.g. 2026-07-18)`);
    process.exitCode = 1;
    return;
  }

  const rows = await db
    .select({
      model: llmUsageEvent.model,
      isBatch: llmUsageEvent.isBatch,
      inputTokens: llmUsageEvent.inputTokens,
      outputTokens: llmUsageEvent.outputTokens,
      cacheReadTokens: llmUsageEvent.cacheReadTokens,
      cacheCreateTokens: llmUsageEvent.cacheCreateTokens,
      webSearchRequests: llmUsageEvent.webSearchRequests,
      createdAt: llmUsageEvent.createdAt,
    })
    .from(llmUsageEvent)
    .where(and(eq(llmUsageEvent.scope, 'batch-verify'), gte(llmUsageEvent.createdAt, windowStart)))
    .orderBy(asc(llmUsageEvent.createdAt));

  if (rows.length === 0) {
    console.log(`No scope='batch-verify' rows in the last ${days} day(s). Nothing to measure yet.`);
    return;
  }

  console.log(
    `\n${rows.length} batch-verify calls, ${rows[0].createdAt.toISOString().slice(0, 10)} → ` +
      `${rows[rows.length - 1].createdAt.toISOString().slice(0, 10)}`,
  );

  // Daily breakdown — same shape as the manual table in
  // batch-verify-cost-characterization.md, but with the search-invocation rate
  // that doc couldn't compute (usedWeb wasn't persisted at the time).
  const byDay = new Map<string, Bucket>();
  for (const row of rows) {
    const day = row.createdAt.toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, emptyBucket());
    addRow(byDay.get(day)!, row);
  }
  console.log('\nday          calls  searched        avg-in-tok  avg-search  est-$');
  for (const [day, b] of [...byDay.entries()].sort()) {
    console.log(
      `${day}   ${String(b.calls).padStart(4)}   ${fmtPct(b.callsWithSearch, b.calls).padStart(6)}         ` +
        `${fmtAvg(b.inputTokens, b.calls).padStart(7)}     ${fmtAvgSearch(b.webSearchRequests, b.calls).padStart(6)}    $${b.usd.toFixed(2)}`,
    );
  }

  // Before/after split at --since, the actual before/after comparison.
  if (cutover) {
    const before = emptyBucket();
    const after = emptyBucket();
    for (const row of rows) addRow(row.createdAt < cutover ? before : after, row);
    console.log(`\n=== before/after split at ${cutover.toISOString().slice(0, 10)} ===`);
    printBucket(`BEFORE (${before.calls} calls)`, before);
    printBucket(`AFTER  (${after.calls} calls)`, after);
    if (before.calls > 0 && after.calls > 0) {
      const searchRateBefore = before.callsWithSearch / before.calls;
      const searchRateAfter = after.callsWithSearch / after.calls;
      const tokBefore = before.inputTokens / before.calls;
      const tokAfter = after.inputTokens / after.calls;
      console.log(
        `\nsearch-invocation rate: ${(searchRateBefore * 100).toFixed(1)}% → ${(searchRateAfter * 100).toFixed(1)}% ` +
          `(${searchRateAfter <= searchRateBefore ? 'down' : 'UP'} ${Math.abs((searchRateAfter - searchRateBefore) * 100).toFixed(1)}pt)`,
      );
      console.log(
        `avg input tokens/call: ${tokBefore.toFixed(0)} → ${tokAfter.toFixed(0)} ` +
          `(${tokAfter <= tokBefore ? 'down' : 'UP'} ${Math.abs(tokAfter - tokBefore).toFixed(0)})`,
      );
    } else {
      console.log('\n(one side of the split has zero calls — not enough data yet for a comparison)');
    }
  } else {
    const total = emptyBucket();
    for (const row of rows) addRow(total, row);
    printBucket(`TOTAL (${days}-day window)`, total);
    console.log(
      '\nRe-run with --since <date the prompt change went live> once there are calls on both sides ' +
        'to get a before/after comparison.',
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
