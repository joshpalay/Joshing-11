#!/usr/bin/env node
// Daily Five build-latency check — the read behind
// diagnosis/daily-build-latency-deferral-plan.md
//
//   npm run check:build-latency
//
// Read-only. Runs the Phase 2 and Phase 3 checks from that doc against the
// live DailyBuildMetric table and says, in words, whether each one passed.
// Safe to run any time; it makes no writes and no LLM calls.
//
// WHY THIS EXISTS AS A SCRIPT. The measurement it performs is a subtraction
// between two columns on one row, and getting it wrong is easy in exactly the
// way this whole effort has been about: forgetting to filter on
// outcome='built' silently mixes in early returns (carry_forward,
// existing_queue) that record zero generation calls and look like fast builds.
// The filter is baked in here so nobody has to remember it.

import 'dotenv/config';
import pg from 'pg';

const DAILY_QUEUE_SIZE = 5;
// Pre-registered on 2026-09-05, before any post-deferral row existed:
// bonus generation was 7,646ms of a 45,909ms build.
//
// Read this as ONE SAMPLE of a variable quantity, not as a prediction the
// deferral either hits or misses. The first post-deferral build spent 544ms on
// bonus generation against the baseline's 7,646ms -- a 14x spread across the
// only two builds ever measured. The deferral moves whatever the bonus costs
// that day off the critical path, so judging each row against a fixed ~7.6s
// reads ordinary variance as underperformance. See bonusCostMs below.
const PREDICTED_SAVING_MS = 7646;

// The bonus work a given build actually did, from its own `rounds` telemetry.
// This is the quantity the deferral removes from the player's wait, which makes
// it the right per-row yardstick -- and unlike the median, it is meaningful at
// n = 1.
function bonusCostMs(rounds) {
  const parsed = typeof rounds === 'string' ? JSON.parse(rounds) : rounds;
  if (!Array.isArray(parsed)) return null;
  const bonus = parsed.filter((r) => r?.phase === 'bonus');
  if (!bonus.length) return null;
  return bonus.reduce((sum, r) => sum + (r.generationMs ?? 0) + (r.gateMs ?? 0), 0);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

const ok = (b) => (b ? 'PASS' : 'FAIL');
const ms = (v) => (v == null ? 'null' : `${v}ms`);

function line(label, value, verdict) {
  const v = verdict === undefined ? '' : `  [${verdict}]`;
  console.log(`  ${label.padEnd(26)} ${String(value).padEnd(28)}${v}`);
}

try {
  const { rows: totals } = await pool.query(
    `select outcome, count(*)::int n from "DailyBuildMetric" group by outcome order by n desc`,
  );
  console.log('\n=== DailyBuildMetric totals ===');
  console.log('  ' + (totals.map((r) => `${r.outcome}=${r.n}`).join('  ') || '(no rows)'));
  console.log('  (analysis uses outcome=built only; the rest are early returns)');

  // The deferral shipped when migration 0139/0140 applied. A post-deferral row
  // is one where `deferred` is non-null -- the column did not exist before.
  const { rows: built } = await pool.query(
    `select build_id, started_at, span_ms, user_visible_ms, deferred,
            borrowed_domain_count, deferred_domain_count, round_count,
            generate_call_count, bank_hit_count, bank_miss_count,
            final_size, rounds
       from "DailyBuildMetric"
      where outcome = 'built'
      order by started_at asc`,
  );

  const pre = built.filter((r) => r.deferred === null);
  const post = built.filter((r) => r.deferred !== null);

  console.log(`\n=== built rows: ${built.length} (${pre.length} pre-deferral, ${post.length} post) ===`);

  if (pre.length) {
    const b = pre[pre.length - 1];
    console.log('\n--- pre-deferral baseline (unrepeatable; span should ~= user_visible) ---');
    line('build_id', b.build_id);
    line('started_at', b.started_at.toISOString());
    line('span / user_visible', `${ms(b.span_ms)} / ${ms(b.user_visible_ms)}`);
    line('difference', ms(b.span_ms - b.user_visible_ms), ok(Math.abs(b.span_ms - b.user_visible_ms) < 500));
  }

  if (!post.length) {
    console.log('\n--- PHASE 2: no post-deferral build yet ---');
    console.log('  The cron builds at 17:05 UTC. A row appears only when a user');
    console.log('  actually needs a queue built -- carry_forward/existing_queue');
    console.log('  rows are early returns and do not count.');
    console.log('  Nothing is wrong; the data does not exist yet.\n');
    process.exit(0);
  }

  // ---- Phase 2: the first post-deferral row, four unknowns in one read ----
  const f = post[0];
  console.log('\n--- PHASE 2: first post-deferral row ---');
  line('build_id', f.build_id);
  line('started_at', f.started_at.toISOString());
  line('deferred', f.deferred, ok(f.deferred === true));
  line('span_ms', ms(f.span_ms), ok(f.span_ms != null));
  line('user_visible_ms', ms(f.user_visible_ms), ok(f.user_visible_ms != null));
  line('borrowed / deferred doms', `${f.borrowed_domain_count} / ${f.deferred_domain_count}`);
  line('final_size', f.final_size);
  line('rounds', JSON.stringify(f.rounds));

  if (f.deferred === true && f.span_ms == null) {
    console.log('\n  !! deferred=true with span_ms=null -> the continuation was DROPPED.');
    console.log('     after() ran but never completed. This is the case the two-phase');
    console.log('     write exists to make visible.');
  }
  if (f.deferred === false) {
    console.log('\n  !! deferred=false -> after() was unavailable, the tail ran INLINE.');
    console.log('     Correct but not faster. If this is a cron build, the deferral is');
    console.log('     inert on the one path that matters.');
  }

  // target_size: intended size, must be the constant, never the achieved count
  const { rows: ts } = await pool.query(
    `select count(*)::int n,
            count(*) filter (where target_size = $1)::int correct,
            count(*) filter (where target_size is null)::int nulls
       from "DailyQueue" where created_at >= $2`,
    [DAILY_QUEUE_SIZE, f.started_at],
  );
  console.log('\n--- target_size on queues built since ---');
  line('rows / = 5 / null', `${ts[0].n} / ${ts[0].correct} / ${ts[0].nulls}`, ok(ts[0].n > 0 && ts[0].correct === ts[0].n));

  // ALS across the after() boundary: bonus-phase LLM calls must carry build_id
  const { rows: attr } = await pool.query(
    `select count(*)::int total,
            count(*) filter (where build_id is not null)::int attributed
       from "LlmUsageEvent"
      where created_at >= $1 and scope = 'generate-questions'`,
    [f.started_at],
  );
  console.log('\n--- LLM call attribution since that build (ALS across after()) ---');
  line('generate calls / with id', `${attr[0].total} / ${attr[0].attributed}`, ok(attr[0].total === 0 || attr[0].attributed > 0));
  if (attr[0].total > 0 && attr[0].attributed === 0) {
    console.log('\n  !! No generate call carries a build_id -> AsyncLocalStorage does NOT');
    console.log('     cross the after() boundary. The deferral still works; the LLM');
    console.log('     accounting for deferred work is silently lost.');
  }

  // ---- Phase 3: the subtraction ----
  const usable = post.filter((r) => r.span_ms != null && r.user_visible_ms != null);
  console.log(`\n--- PHASE 3: the subtraction (${usable.length} usable row${usable.length === 1 ? '' : 's'}) ---`);
  if (!usable.length) {
    console.log('  No row has both fields yet.\n');
  } else {
    const diffs = usable.map((r) => r.span_ms - r.user_visible_ms).sort((a, b) => a - b);
    const median = diffs[Math.floor(diffs.length / 2)];
    for (const r of usable) {
      console.log(
        `  ${r.started_at.toISOString()}  span ${String(r.span_ms).padStart(6)}  visible ${String(
          r.user_visible_ms,
        ).padStart(6)}  saved ${String(r.span_ms - r.user_visible_ms).padStart(6)}ms  deferred=${r.deferred}`,
      );
    }

    // 3a -- MECHANISM. Works at n = 1. The saving must be at LEAST the bonus
    // cost this build paid: you cannot move work off the critical path and save
    // less than the work was worth. Anything above it is other deferred
    // overhead (chunk orchestration, the queue write, the after() boundary
    // itself) that the per-round generationMs does not count.
    //
    // So the residual is reported, not judged. A residual that stays put across
    // rows is fixed overhead and is a finding in its own right -- it means the
    // deferral is worth more than the bonus generation time alone suggests. A
    // residual that swings around is measurement noise and wants explaining.
    console.log('\n  3a MECHANISM -- saving vs this build\'s own bonus cost:');
    const residuals = [];
    for (const r of usable) {
      const saved = r.span_ms - r.user_visible_ms;
      const bonus = bonusCostMs(r.rounds);
      if (bonus == null) {
        console.log(`  ${r.started_at.toISOString()}  saved ${saved}ms  bonus cost unknown (no bonus round logged)`);
        continue;
      }
      residuals.push(saved - bonus);
      console.log(
        `  ${r.started_at.toISOString()}  saved ${String(saved).padStart(6)}ms  bonus ${String(bonus).padStart(
          6,
        )}ms  residual ${String(saved - bonus).padStart(6)}ms   [${ok(saved >= bonus)}]`,
      );
    }
    if (residuals.length > 1) {
      const lo = Math.min(...residuals);
      const hi = Math.max(...residuals);
      console.log(
        `\n  residual spread: ${lo}..${hi}ms over ${residuals.length} rows -- ${
          hi - lo <= Math.max(400, lo * 0.5)
            ? 'stable, reads as fixed non-generation overhead the deferral also removes.'
            : 'wide; explain before relying on it.'
        }`,
      );
    }

    // 3b -- POPULATION. Needs several rows, and the prediction is a reference
    // point rather than a target (see PREDICTED_SAVING_MS).
    console.log(`\n  3b POPULATION -- median saving: ${median}ms   (baseline build's bonus cost: ~${PREDICTED_SAVING_MS}ms)`);
    if (usable.length < 3) {
      console.log('  n < 3 -- instrument reading, not yet a population estimate.');
      console.log('  Do NOT read a small median as the deferral underperforming: it');
      console.log('  saves what that day\'s bonus cost, and that varies by >10x.');
    }
  }
  console.log('');
} catch (err) {
  console.error('\nbuild-latency-check failed:', err.message);
  console.error('(needs DATABASE_URL in .env; read-only, safe to retry)\n');
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
