// Step 0 baseline for the LLM cost transition — READ-ONLY.
//
// The weekly digest (src/server/db/queries/llm-cost-report.ts) rolls raw
// LlmUsageEvent.scope strings up into seven plain-English surfaces. That is the
// right shape for a human skim and the wrong shape for a cost decision: the
// "Fact-checking questions" surface alone folds seven scopes spanning new-question
// verification, post-hoc rechecks, audits, and ask-to-answer. This script reports
// the RAW scopes, classifies each as recurring / gameplay / non-recurring, and
// prints the supply-side denominators the classification needs to mean anything.
//
// It answers Step 0 of the cost plan except the one part no query can reach:
// reconciliation against Anthropic's own billing. See "ledger caveats" in the
// output for the two known directions of drift.
//
// Usage (DATABASE_URL in .env is prod — every query here is a SELECT):
//   npx tsx -r dotenv/config scripts/llm-cost-baseline.ts
//   npx tsx -r dotenv/config scripts/llm-cost-baseline.ts --start 2026-08-10 --end 2026-08-24
//   ...add --json for machine-readable output.
import 'dotenv/config';

import { pool } from '../src/server/db';
import { MODEL_PRICING, estimateCostUsd } from '../src/server/llm/pricing';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 || i + 1 >= argv.length ? undefined : argv[i + 1];
};
const asJson = argv.includes('--json');

// Default window: the trailing 14 days, which is what the digest reports on.
const end = flag('--end') ?? new Date().toISOString().slice(0, 10);
const start =
  flag('--start') ??
  new Date(Date.parse(`${end}T00:00:00Z`) - 13 * 86_400_000).toISOString().slice(0, 10);

/**
 * Decision A of the plan: every dollar must land in exactly one of these, and
 * "recurring" must not silently absorb work that only happens once.
 *
 * `recurring`     — steady-state cost of maintaining supply for the players we have.
 * `gameplay`      — the marginal cost of serving/grading a question already made.
 * `onboarding`    — per-new-player cost; recurring only while we are adding players.
 * `commentary`    — per-answer prose (asides, explainers, breadcrumbs).
 * `non-recurring` — audits, healing sweeps, migrations, backfills. Reported apart.
 * `user-triggered`— a human pressed something (recheck, salvage, ask-to-answer).
 * `admin`         — internal tooling: dashboards, proposals, diagnostics.
 *
 * A scope missing from this map falls into `UNCLASSIFIED` and is printed loudly
 * rather than folded into a bucket — the same fail-loud posture as the digest's
 * "Other / unmapped".
 */
const SCOPE_CLASS: Record<string, string> = {
  // Steady-state supply.
  'generate-questions': 'recurring',
  'quality-gate': 'recurring',
  'factual-gate': 'recurring',
  critique: 'recurring',
  difficulty: 'recurring',
  'batch-dedupe': 'recurring',
  'history-dedupe': 'recurring',
  'vet-question': 'recurring',
  'batch-verify': 'recurring',
  'domain-reference': 'recurring',
  'ask-to-answer-cold': 'recurring',
  'ask-to-answer-judge': 'recurring',

  // Background refill — recurring IF the flags are on. Broken out separately in
  // the report because whether these fired at all is the plan's open question.
  'pool-refill-generate': 'refill',
  'backfill-supply-generate': 'refill',

  // Player-facing.
  grade: 'gameplay',
  explainer: 'commentary',
  'reflection-explainer': 'commentary',
  'inside-joke': 'commentary',
  breadcrumb: 'commentary',
  'ceremony-narrative': 'commentary',

  // Per-new-player.
  'interests-answerability': 'onboarding',
  'interests-canonicalize': 'onboarding',
  'interests-categorize-domain': 'onboarding',
  'interests-expand': 'onboarding',
  'interests-proofread': 'onboarding',
  'interests-suggest': 'onboarding',
  'interests-suggest-adjacent': 'onboarding',
  'interests-suggest-broader': 'onboarding',

  // Deliberate, non-steady-state work.
  'self-containment': 'non-recurring',
  'audit:gate': 'non-recurring',
  'fill-rich-generate': 'non-recurring',
  'hamlet-ab-generate': 'non-recurring',
  'node-weight-depth': 'non-recurring',
  'mastery-threshold-points': 'non-recurring',

  // Someone pressed a button.
  recheck: 'user-triggered',
  'salvage-propose': 'user-triggered',
  'enrich-variants': 'user-triggered',
  'questions-suggest-verify': 'user-triggered',
  'crafter-draft': 'user-triggered',
  multitudes: 'user-triggered',

  // Internal tooling.
  'prompt-proposal': 'admin',
};
const UNCLASSIFIED = 'UNCLASSIFIED';

type ScopeRow = {
  scope: string;
  model: string;
  is_batch: boolean;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  web_search_requests: number;
};

const usd = (n: number) => `$${n.toFixed(4)}`;
const pad = (s: string | number, w: number) => String(s).padEnd(w);
const lpad = (s: string | number, w: number) => String(s).padStart(w);

async function main() {
  const out: Record<string, unknown> = { window: { start, end } };

  // ── 1. Raw scope × model rollup ───────────────────────────────────────────
  const { rows: scopeRows } = await pool.query<ScopeRow>(
    `SELECT scope, model, is_batch,
            count(*)::int                       AS calls,
            sum(input_tokens)::bigint           AS input_tokens,
            sum(output_tokens)::bigint          AS output_tokens,
            sum(cache_read_tokens)::bigint      AS cache_read_tokens,
            sum(cache_create_tokens)::bigint    AS cache_create_tokens,
            sum(web_search_requests)::bigint    AS web_search_requests
       FROM "LlmUsageEvent"
      WHERE created_at >= $1::date AND created_at < ($2::date + 1)
      GROUP BY scope, model, is_batch
      ORDER BY scope, model`,
    [start, end],
  );

  type Priced = ScopeRow & { usd: number; unpriced: boolean; klass: string };
  const priced: Priced[] = scopeRows.map((r) => {
    const est = estimateCostUsd(r.model, {
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheCreateTokens: Number(r.cache_create_tokens),
      webSearchRequests: Number(r.web_search_requests),
      isBatch: r.is_batch,
    });
    return {
      ...r,
      usd: est.usd ?? 0,
      unpriced: est.unpriced,
      klass: SCOPE_CLASS[r.scope] ?? UNCLASSIFIED,
    };
  });

  const byScope = new Map<string, Priced[]>();
  for (const p of priced) {
    const list = byScope.get(p.scope) ?? [];
    list.push(p);
    byScope.set(p.scope, list);
  }

  const scopeTotals = [...byScope.entries()]
    .map(([scope, rows]) => ({
      scope,
      klass: rows[0].klass,
      calls: rows.reduce((a, r) => a + r.calls, 0),
      usd: rows.reduce((a, r) => a + r.usd, 0),
      searches: rows.reduce((a, r) => a + Number(r.web_search_requests), 0),
      models: [...new Set(rows.map((r) => r.model))],
      unpriced: rows.some((r) => r.unpriced),
    }))
    .sort((a, b) => b.usd - a.usd);

  const grandTotal = scopeTotals.reduce((a, s) => a + s.usd, 0);
  const classTotals = new Map<string, { usd: number; calls: number }>();
  for (const s of scopeTotals) {
    const acc = classTotals.get(s.klass) ?? { usd: 0, calls: 0 };
    acc.usd += s.usd;
    acc.calls += s.calls;
    classTotals.set(s.klass, acc);
  }

  out.scopes = scopeTotals;
  out.classes = Object.fromEntries(classTotals);
  out.totalUsd = grandTotal;

  if (!asJson) {
    console.log(`\n═══ LLM cost baseline — ${start} → ${end} ═══\n`);
    console.log('── By raw scope (the digest folds these into 7 surfaces) ──');
    console.log(
      `${pad('scope', 30)}${pad('class', 16)}${lpad('calls', 7)}${lpad('searches', 10)}${lpad('usd', 11)}   models`,
    );
    for (const s of scopeTotals) {
      console.log(
        `${pad(s.scope, 30)}${pad(s.klass, 16)}${lpad(s.calls, 7)}${lpad(s.searches, 10)}${lpad(usd(s.usd), 11)}   ${s.models.join(', ')}${s.unpriced ? '  ⚠ UNPRICED' : ''}`,
      );
    }
    console.log(`${pad('TOTAL', 46)}${lpad(scopeTotals.reduce((a, s) => a + s.calls, 0), 7)}${lpad(scopeTotals.reduce((a, s) => a + s.searches, 0), 10)}${lpad(usd(grandTotal), 11)}`);

    console.log('\n── By cost class ──');
    for (const [klass, v] of [...classTotals.entries()].sort((a, b) => b[1].usd - a[1].usd)) {
      const pct = grandTotal > 0 ? ((v.usd / grandTotal) * 100).toFixed(1) : '0.0';
      console.log(`${pad(klass, 16)}${lpad(usd(v.usd), 11)}${lpad(`${pct}%`, 8)}${lpad(v.calls, 8)} calls`);
    }
  }

  // ── 2. Unpriced models (ledger reads $0 for these) ────────────────────────
  const unpricedModels = [...new Set(priced.filter((p) => p.unpriced).map((p) => p.model))];
  out.unpricedModels = unpricedModels;
  if (!asJson && unpricedModels.length > 0) {
    console.log(`\n⚠  Unpriced models (counted as $0 in every ledger figure): ${unpricedModels.join(', ')}`);
  }

  // ── 3. Which background paths actually ran (60-day view) ──────────────────
  const { rows: activity } = await pool.query<{
    scope: string;
    first_seen: string;
    last_seen: string;
    active_days: number;
    calls: number;
  }>(
    `SELECT scope,
            min(created_at)::text                     AS first_seen,
            max(created_at)::text                     AS last_seen,
            count(DISTINCT created_at::date)::int     AS active_days,
            count(*)::int                             AS calls
       FROM "LlmUsageEvent"
      WHERE created_at >= now() - interval '60 days'
        AND scope IN ('pool-refill-generate','backfill-supply-generate','generate-questions',
                      'domain-reference','batch-verify','vet-question','self-containment')
      GROUP BY scope
      ORDER BY scope`,
  );
  out.backgroundPathActivity = activity;
  if (!asJson) {
    console.log('\n── Background supply paths, last 60 days (absence ⇒ flag is off) ──');
    if (activity.length === 0) console.log('   (no rows for any tracked background scope)');
    for (const a of activity) {
      console.log(
        `${pad(a.scope, 30)}${lpad(a.calls, 7)} calls  ${lpad(a.active_days, 3)} active days   ${a.first_seen.slice(0, 16)} → ${a.last_seen.slice(0, 16)}`,
      );
    }
    for (const s of ['pool-refill-generate', 'backfill-supply-generate']) {
      if (!activity.some((a) => a.scope === s)) {
        console.log(`   ✔ ${s}: ZERO calls in 60 days — that refill path is not running.`);
      }
    }
  }

  // ── 4. Supply funnel in the window ────────────────────────────────────────
  const { rows: funnel } = await pool.query<{
    generated: number;
    suppressed: number;
    ok: number;
    demoted: number;
    unverifiable: number;
    unverified: number;
  }>(
    `SELECT count(*)::int                                                              AS generated,
            count(*) FILTER (WHERE is_duplicate)::int                                  AS suppressed,
            count(*) FILTER (WHERE verification_verdict = 'ok')::int                   AS ok,
            count(*) FILTER (WHERE verification_verdict = 'demoted')::int              AS demoted,
            count(*) FILTER (WHERE verification_verdict = 'unverifiable')::int         AS unverifiable,
            count(*) FILTER (WHERE verified_at IS NULL)::int                           AS unverified
       FROM "GeneratedQuestion"
      WHERE created_at >= $1::date AND created_at < ($2::date + 1)`,
    [start, end],
  );
  out.supplyFunnel = funnel[0];
  if (!asJson) {
    const f = funnel[0];
    console.log('\n── Supply funnel (GeneratedQuestion rows created in window) ──');
    console.log(`   generated ${f.generated}   suppressed-as-duplicate ${f.suppressed}   verdict ok ${f.ok}   demoted ${f.demoted}   unverifiable ${f.unverifiable}   not-yet-swept ${f.unverified}`);
    // Trusted = survived both the dedup suppression and the verifier. Rows the
    // verifier has not reached yet are NOT counted as trusted.
    const rejected = f.suppressed + f.demoted + f.unverifiable;
    const trusted = f.generated - rejected - f.unverified;
    if (f.generated > 0) {
      console.log(`   reject rate ${((rejected / f.generated) * 100).toFixed(1)}%   trusted ${trusted}   all-in cost per trusted question ${trusted > 0 ? usd(grandTotal / trusted) : 'n/a'} (incl. non-recurring — see caveats)`);
    }
  }

  // ── 5. Bank inventory ─────────────────────────────────────────────────────
  const { rows: stock } = await pool.query<{
    domains: number;
    rows_servable: number;
    below_floor: number;
    dry: number;
  }>(
    `WITH per_domain AS (
       SELECT canonical_subcategory AS domain, count(*)::int AS n
         FROM "GeneratedQuestion"
        WHERE used_in_queue = false
          AND is_duplicate = false
          AND fact_key IS NOT NULL
        GROUP BY canonical_subcategory
     )
     SELECT count(*)::int                                  AS domains,
            coalesce(sum(n), 0)::int                       AS rows_servable,
            count(*) FILTER (WHERE n < 10)::int            AS below_floor,
            count(*) FILTER (WHERE n = 0)::int             AS dry
       FROM per_domain`,
  );
  out.bankStock = stock[0];
  if (!asJson) {
    const s = stock[0];
    console.log('\n── Unused bank stock (org-wide; serving is per-user, so this is an upper bound) ──');
    console.log(`   ${s.rows_servable} unused non-duplicate rows across ${s.domains} domains; ${s.below_floor} domains below the stocked floor of 10`);
  }

  // ── 6. "Emergency" (just-in-time) generation share ────────────────────────
  // A bot slot is JIT when its GeneratedQuestion was created within 5 minutes of
  // the queue that serves it — i.e. the build generated it live instead of
  // drawing pre-existing stock.
  const { rows: jit } = await pool.query<{
    queues: number;
    bot_slots: number;
    jit_slots: number;
    queues_with_jit: number;
  }>(
    `WITH slot AS (
       SELECT q.id AS queue_id, q.created_at AS queue_at,
              (s->>'generated_question_id') AS gq_id
         FROM "DailyQueue" q,
              LATERAL jsonb_array_elements(q.slots) s
        WHERE q.created_at >= $1::date AND q.created_at < ($2::date + 1)
          AND s->>'generated_question_id' IS NOT NULL
     ),
     marked AS (
       SELECT slot.queue_id,
              (gq.created_at >= slot.queue_at - interval '5 minutes') AS is_jit
         FROM slot
         JOIN "GeneratedQuestion" gq ON gq.id = slot.gq_id
     )
     SELECT (SELECT count(*)::int FROM "DailyQueue"
              WHERE created_at >= $1::date AND created_at < ($2::date + 1))    AS queues,
            count(*)::int                                                      AS bot_slots,
            count(*) FILTER (WHERE is_jit)::int                                AS jit_slots,
            count(DISTINCT queue_id) FILTER (WHERE is_jit)::int                AS queues_with_jit
       FROM marked`,
    [start, end],
  );
  out.jitGeneration = jit[0];
  if (!asJson) {
    const j = jit[0];
    const pct = j.bot_slots > 0 ? ((j.jit_slots / j.bot_slots) * 100).toFixed(1) : '0.0';
    console.log('\n── Just-in-time ("emergency") generation ──');
    console.log(`   ${j.queues} queues built; ${j.bot_slots} generated slots served, ${j.jit_slots} of them generated live (${pct}%)`);
    console.log(`   ${j.queues_with_jit} queues needed at least one live generation`);
  }

  // ── 7. Denominators ───────────────────────────────────────────────────────
  const { rows: denom } = await pool.query<{
    queues: number;
    users_with_queue: number;
    onboarded_users: number;
    core_slots: number;
    answered_core: number;
    complete_fives: number;
  }>(
    `WITH core AS (
       SELECT q.id AS queue_id,
              count(*)::int                                        AS core_slots,
              count(*) FILTER (WHERE (s->>'answered')::boolean)::int AS answered
         FROM "DailyQueue" q,
              LATERAL jsonb_array_elements(q.slots) s
        WHERE q.created_at >= $1::date AND q.created_at < ($2::date + 1)
          AND s->>'presence_source_id' IS NULL
          AND s->>'return_scope' IS NULL
        GROUP BY q.id
     )
     SELECT (SELECT count(*)::int FROM "DailyQueue"
              WHERE created_at >= $1::date AND created_at < ($2::date + 1))          AS queues,
            (SELECT count(DISTINCT user_id)::int FROM "DailyQueue"
              WHERE created_at >= $1::date AND created_at < ($2::date + 1))          AS users_with_queue,
            -- "User" is one of the camelCase tables; "DailyQueue" is snake_case.
            (SELECT count(*)::int FROM "User" WHERE "onboardingComplete" = true)      AS onboarded_users,
            coalesce(sum(core_slots), 0)::int                                        AS core_slots,
            coalesce(sum(answered), 0)::int                                          AS answered_core,
            count(*) FILTER (WHERE answered >= core_slots AND core_slots > 0)::int   AS complete_fives
       FROM core`,
    [start, end],
  );
  out.denominators = denom[0];
  if (!asJson) {
    const d = denom[0];
    console.log('\n── Denominators ──');
    console.log(`   ${d.onboarded_users} onboarded accounts; ${d.users_with_queue} received a queue; ${d.queues} queues built`);
    console.log(`   ${d.answered_core}/${d.core_slots} core slots answered; ${d.complete_fives} completed Daily Fives`);
    if (d.complete_fives > 0) {
      console.log(`   all-in cost per completed Daily Five: ${usd(grandTotal / d.complete_fives)} (denominator is small — do not gate on this yet)`);
    }
    if (d.queues > 0 && d.onboarded_users > 0) {
      console.log(`   queues built per onboarded account: ${(d.queues / d.onboarded_users).toFixed(1)} over ${Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1} days`);
    }
  }

  if (!asJson) {
    console.log('\n── Ledger caveats (both directions — the ledger is NOT a floor) ──');
    console.log('   ・ UNDER-counts: recordLlmUsage only fires on a successful response, so provider-billed');
    console.log('     timeouts and failures are invisible (src/lib/llm.ts).');
    const sonnet5 = MODEL_PRICING['claude-sonnet-5'];
    if (sonnet5) {
      console.log(`   ・ OVER-counts: claude-sonnet-5 is priced at sticker $${sonnet5.inputPerMtok}/$${sonnet5.outputPerMtok} while Anthropic bills`);
      console.log('     an introductory $2/$10 through 2026-08-31 — generation reads ~33% high in this window.');
    }
    console.log('   ・ Cost is derived at read time, so editing pricing.ts reprices all history.');
    console.log('   ・ Reconciliation against Anthropic billing needs Console/Admin-API access — not in this DB.\n');
  }

  if (asJson) console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
