#!/usr/bin/env node
// Aggregate-only question lifecycle check. Read-only: no writes and no model calls.
// Use after deploy to compare the same measures recorded in
// .reports/question-lifecycle-results.md.

import 'dotenv/config';
import pg from 'pg';

const parsedDays = Number.parseInt(process.env.DAYS || '14', 10);
const days = Number.isFinite(parsedDays) ? Math.min(180, Math.max(1, parsedDays)) : 14;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

function heading(value) {
  console.log(`\n=== ${value} ===`);
}

function line(label, value) {
  console.log(`  ${label.padEnd(34)} ${value}`);
}

try {
  const { rows: schemaRows } = await pool.query(
    `select exists (
       select 1 from information_schema.columns
       where table_name = 'GateDropStat' and column_name = 'scope'
     ) as gate_scope`,
  );
  const gateScope = schemaRows[0]?.gate_scope === true;

  const [{ rows: generated }, { rows: twins }, { rows: builds }, { rows: grading }, { rows: disputes }] =
    await Promise.all([
      pool.query(
        `select count(*)::int as live,
                count(*) filter (where subject_entity is null)::int as missing_subject,
                count(*) filter (where embedding is null)::int as missing_embedding,
                count(*) filter (
                  where verification_verdict = 'ok' and trust_tier = 'unverified'
                )::int as ok_but_unverified,
                count(*) filter (where verification_verdict = 'unverifiable')::int as unverifiable
           from "GeneratedQuestion"
          where is_duplicate = false
            and created_at >= now() - make_interval(days => $1)`,
        [days],
      ),
      pool.query(
        `select count(*)::int as linked,
                count(*) filter (where q.answer_text is distinct from g.answer)::int as answer_drift,
                count(*) filter (
                  where coalesce(q.accepted_alternatives, array[]::text[])
                    is distinct from coalesce(g.acceptable_variants, array[]::text[])
                )::int as alternative_drift
           from "Question" q
           join "GeneratedQuestion" g on g.id = q.generated_question_id
          where q.deleted_at is null and g.is_duplicate = false`,
      ),
      pool.query(
        `select count(*)::int as builds,
                percentile_cont(0.5) within group (order by user_visible_ms) as p50_ms,
                percentile_cont(0.95) within group (order by user_visible_ms) as p95_ms,
                max(user_visible_ms)::int as max_ms,
                count(*) filter (where final_size < target_size)::int as short_builds,
                sum(bank_hit_count)::int as bank_hits,
                sum(bank_miss_count)::int as bank_misses
           from "DailyBuildMetric"
          where outcome = 'built'
            and started_at >= now() - make_interval(days => $1)`,
        [days],
      ),
      pool.query(
        `select count(*)::int as calls,
                percentile_cont(0.5) within group (order by duration_ms) as p50_ms,
                percentile_cont(0.95) within group (order by duration_ms) as p95_ms
           from "LlmUsageEvent"
          where scope = 'grade'
            and created_at >= now() - make_interval(days => $1)`,
        [days],
      ),
      pool.query(
        `select status, count(*)::int as n
           from "GradeDispute"
          where created_at >= now() - make_interval(days => $1)
          group by status order by status`,
        [days],
      ),
    ]);

  heading(`Question lifecycle — trailing ${days} days`);
  const g = generated[0] || {};
  line('live generated rows', g.live ?? 0);
  line('missing subject_entity', g.missing_subject ?? 0);
  line('missing embedding', g.missing_embedding ?? 0);
  line('verified ok but unverified tier', g.ok_but_unverified ?? 0);
  line('later verdict unverifiable', g.unverifiable ?? 0);

  heading('Linked-copy agreement — all live links');
  const t = twins[0] || {};
  line('linked rows', t.linked ?? 0);
  line('canonical-answer drift', t.answer_drift ?? 0);
  line('accepted-alternative drift', t.alternative_drift ?? 0);

  heading('Daily Five builds');
  const b = builds[0] || {};
  line('built rows', b.builds ?? 0);
  line('visible p50 / p95 / max', `${Math.round(b.p50_ms ?? 0)} / ${Math.round(b.p95_ms ?? 0)} / ${b.max_ms ?? 0} ms`);
  line('short builds', b.short_builds ?? 0);
  line('bank hits / misses', `${b.bank_hits ?? 0} / ${b.bank_misses ?? 0}`);

  heading('Model grading');
  const grade = grading[0] || {};
  line('calls', grade.calls ?? 0);
  line('duration p50 / p95', `${Math.round(grade.p50_ms ?? 0)} / ${Math.round(grade.p95_ms ?? 0)} ms`);
  line('disputes by status', disputes.map((row) => `${row.status}=${row.n}`).join(', ') || 'none');

  heading('Generation gate measurement');
  line('scope support', gateScope ? 'daily_build only' : 'not migrated; maintenance may be mixed in');
  if (gateScope) {
    const { rows: gates } = await pool.query(
      `select gate, sum(considered)::int as considered, sum(dropped)::int as dropped,
              sum(failed_open)::int as failed_open
         from "GateDropStat"
        where scope = 'daily_build'
          and day >= current_date - ($1::int - 1)
        group by gate order by gate`,
      [days],
    );
    for (const gate of gates) {
      line(gate.gate, `${gate.dropped}/${gate.considered} dropped; ${gate.failed_open} failed-open`);
    }
  }

  console.log('\nAggregate counts only. No player answers or identity fields are printed.\n');
} catch (error) {
  console.error('\ncheck-question-lifecycle failed:', error instanceof Error ? error.message : String(error));
  console.error('(needs DATABASE_URL in .env; this check is read-only)\n');
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
