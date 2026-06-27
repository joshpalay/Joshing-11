/**
 * Read-and-report layer for the weekly LLM cost & latency digest
 * (B-LLM-COST-LATENCY-REPORT-01). A small extension of the
 * B-LLM-PROVIDER-AB-METRICS telemetry: it reads the same LlmUsageEvent rows that
 * recordLlmUsage already writes and rolls them up by *surface* (a plain-English
 * grouping a non-engineer reasons about) instead of by provider+model.
 *
 * A deliberately separate sibling file from llm-provider-experiment.ts (O3): the
 * A/B experiment stays an independently-removable unit, and this report reuses
 * its pricing (estimateCostUsd) and its table without entangling the two.
 *
 * NOTHING here is on an LLM call path — it is pure read-and-report over data
 * already recorded. Cost is still derived at read time from pricing.ts, so a
 * price edit reprices history with no backfill.
 */
import { and, desc, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';

import { adminUserIds } from '@/server/auth/admin';
import { db, generatedQuestions, llmCostReport, llmUsageEvent, masteryEvents, users } from '@/server/db';
import { estimateCostUsd } from '@/server/llm/pricing';

// ─── Decision A: the surface taxonomy ────────────────────────────────────────

/**
 * One plain-English surface bucket and the raw LlmUsageEvent.scope strings that
 * roll up into it. This single constant IS the mapping — adding a new scope to
 * the codebase is a one-line edit here (or it falls into "Other / unmapped"
 * automatically, never silently vanishing).
 *
 * `playerFacing` marks surfaces a human waits on live (the live answer-grade
 * round-trip; interest processing during onboarding). Only these are eligible to
 * be named as "the slowest player-facing surface" in the digest — a background
 * pool-refill generation being slow is not something a player ever feels.
 *
 * Decision D (verified 2026-06-27): grading records usage under scope 'grade'
 * (src/lib/llm.ts:734, dispatchLlmText('grade', …) → recordLlmUsage). The
 * "Grading answers" bucket therefore reads a real figure, not an empty $0.
 */
export type SurfaceBucket = {
  key: string;
  label: string;
  scopes: string[];
  playerFacing: boolean;
};

export const SURFACE_BUCKETS: SurfaceBucket[] = [
  {
    key: 'generate',
    label: 'Generating questions',
    playerFacing: false,
    scopes: ['generate-questions', 'pool-refill-generate', 'multitudes'],
  },
  {
    key: 'quality',
    label: 'Checking question quality',
    playerFacing: false,
    scopes: [
      'quality-gate',
      'factual-gate',
      'critique',
      'vet-question',
      'recheck',
      'difficulty',
      'batch-dedupe',
      'history-dedupe',
    ],
  },
  {
    key: 'grade',
    label: 'Grading answers',
    playerFacing: true,
    scopes: ['grade'],
  },
  {
    key: 'interests',
    label: 'Understanding interests',
    playerFacing: true,
    scopes: [
      'interests-answerability',
      'interests-canonicalize',
      'interests-categorize-domain',
      'interests-expand',
      'interests-proofread',
      'interests-suggest',
      'interests-suggest-adjacent',
    ],
  },
  {
    key: 'tagging',
    label: 'Suggesting / tagging',
    playerFacing: false,
    scopes: [
      'questions-suggest',
      'suggest-tags',
      'suggest-answer',
      'resolve-subcategory',
      'reconcile-subcategory',
      'clean-question',
      'categorize',
    ],
  },
  {
    key: 'copy',
    label: 'Writing player-facing copy',
    playerFacing: false,
    scopes: ['explainer', 'reflection-explainer', 'inside-joke', 'ceremony-narrative', 'breadcrumb'],
  },
];

// Hard requirement (Decision A1): a catch-all so a newly-added scope shows up
// somewhere rather than disappearing from the spend total.
export const OTHER_BUCKET: SurfaceBucket = {
  key: 'other',
  label: 'Other / unmapped',
  playerFacing: false,
  scopes: [],
};

/** Display/iteration order: the mapped buckets, then the catch-all last. */
export const ALL_BUCKETS: SurfaceBucket[] = [...SURFACE_BUCKETS, OTHER_BUCKET];

/** Resolve a raw scope string to its surface bucket (catch-all if unmapped). */
export function bucketForScope(scope: string): SurfaceBucket {
  return SURFACE_BUCKETS.find((b) => b.scopes.includes(scope)) ?? OTHER_BUCKET;
}

// A SQL CASE that maps the scope column to a bucket key. Built from the constant
// above, so the taxonomy stays defined in exactly one place. Every value
// interpolated here is a compile-time literal from our own code (bucket keys and
// scope strings) — no user input reaches this raw fragment.
const bucketCaseSql = sql.raw(
  `CASE ${SURFACE_BUCKETS.map(
    (b) => `WHEN "scope" IN (${b.scopes.map((s) => `'${s}'`).join(', ')}) THEN '${b.key}'`,
  ).join(' ')} ELSE '${OTHER_BUCKET.key}' END`,
);

// ─── Window helpers ──────────────────────────────────────────────────────────

/**
 * A trailing window expressed as a half-open [startDaysAgo, endDaysAgo) range,
 * e.g. the current week is (7, 0) and the prior week is (14, 7). endDaysAgo = 0
 * means "up to now".
 */
function inWindow(startDaysAgo: number, endDaysAgo: number) {
  const start = gte(llmUsageEvent.createdAt, sql`now() - make_interval(days => ${startDaysAgo})`);
  if (endDaysAgo <= 0) return start;
  return and(start, lt(llmUsageEvent.createdAt, sql`now() - make_interval(days => ${endDaysAgo})`));
}

// ─── Per-surface cost ────────────────────────────────────────────────────────

export type SurfaceCost = {
  key: string;
  label: string;
  playerFacing: boolean;
  calls: number;
  costUsd: number;
  /** True when any model in this bucket has no price row — the figure is a floor. */
  unpriced: boolean;
};

/**
 * Spend per surface over a trailing window, USD derived per (bucket, model) so
 * each model's tokens are priced with its own rate, then folded to the bucket.
 * A bucket that contains an unpriced model surfaces `unpriced: true` and its
 * dollar figure is a floor (priced rows only), never a misleading $0.
 */
export async function readSurfaceCost(startDaysAgo: number, endDaysAgo = 0): Promise<SurfaceCost[]> {
  const rows = await db
    .select({
      bucket: bucketCaseSql.mapWith(String).as('bucket'),
      model: llmUsageEvent.model,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${llmUsageEvent.inputTokens}), 0)::float8`,
      outputTokens: sql<number>`coalesce(sum(${llmUsageEvent.outputTokens}), 0)::float8`,
      cacheReadTokens: sql<number>`coalesce(sum(${llmUsageEvent.cacheReadTokens}), 0)::float8`,
      cacheCreateTokens: sql<number>`coalesce(sum(${llmUsageEvent.cacheCreateTokens}), 0)::float8`,
    })
    .from(llmUsageEvent)
    .where(inWindow(startDaysAgo, endDaysAgo))
    .groupBy(bucketCaseSql, llmUsageEvent.model);

  const acc = new Map<string, { calls: number; costUsd: number; unpriced: boolean }>();
  for (const r of rows) {
    const est = estimateCostUsd(r.model, {
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      cacheReadTokens: Number(r.cacheReadTokens),
      cacheCreateTokens: Number(r.cacheCreateTokens),
    });
    const cur = acc.get(r.bucket) ?? { calls: 0, costUsd: 0, unpriced: false };
    cur.calls += Number(r.calls);
    if (est.unpriced) cur.unpriced = true;
    else cur.costUsd += est.usd ?? 0;
    acc.set(r.bucket, cur);
  }

  return ALL_BUCKETS.filter((b) => acc.has(b.key)).map((b) => {
    const v = acc.get(b.key)!;
    return { key: b.key, label: b.label, playerFacing: b.playerFacing, ...v };
  });
}

// ─── Per-surface latency ─────────────────────────────────────────────────────

export type SurfaceLatency = {
  key: string;
  label: string;
  playerFacing: boolean;
  calls: number;
  avgMs: number | null;
  /** p95 via percentile_cont (Decision O2); null when no timed call in the window. */
  p95Ms: number | null;
};

/**
 * Average and p95 wait time per surface over a trailing window. Only rows with a
 * recorded duration_ms count toward the latency figures (older/partial rows may
 * lack it). p95 uses percentile_cont, which reads acceptably at this row volume;
 * if that ever changes, swap to max() with a relabel (O2).
 */
export async function readSurfaceLatency(startDaysAgo: number, endDaysAgo = 0): Promise<SurfaceLatency[]> {
  const rows = await db
    .select({
      bucket: bucketCaseSql.mapWith(String).as('bucket'),
      calls: sql<number>`(count(*) filter (where ${llmUsageEvent.durationMs} is not null))::int`,
      avgMs: sql<number | null>`avg(${llmUsageEvent.durationMs})::float8`,
      p95Ms: sql<number | null>`percentile_cont(0.95) within group (order by ${llmUsageEvent.durationMs})::float8`,
    })
    .from(llmUsageEvent)
    .where(inWindow(startDaysAgo, endDaysAgo))
    .groupBy(bucketCaseSql);

  const byKey = new Map(rows.map((r) => [r.bucket, r]));
  return ALL_BUCKETS.filter((b) => byKey.has(b.key)).map((b) => {
    const r = byKey.get(b.key)!;
    return {
      key: b.key,
      label: b.label,
      playerFacing: b.playerFacing,
      calls: Number(r.calls),
      avgMs: r.avgMs != null ? Number(r.avgMs) : null,
      p95Ms: r.p95Ms != null ? Number(r.p95Ms) : null,
    };
  });
}

// ─── Volume denominators (O1) ────────────────────────────────────────────────

/** Count of bot questions generated in the trailing window — denominator for cost/question. */
async function countQuestionsGenerated(startDaysAgo: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(generatedQuestions)
    .where(gte(generatedQuestions.createdAt, sql`now() - make_interval(days => ${startDaysAgo})`));
  return Number(row?.n ?? 0);
}

/**
 * Count of answers an LLM actually graded in the window — denominator for
 * cost/answer-graded. Matches the 'grade' scope's cost: exact-match and give-up
 * answers carry no llm_provider and never hit a grading LLM call, so excluding
 * them keeps numerator and denominator on the same population.
 */
async function countAnswersGraded(startDaysAgo: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(masteryEvents)
    .where(
      and(
        sql`${masteryEvents.llmProvider} is not null`,
        gte(masteryEvents.createdAt, sql`now() - make_interval(days => ${startDaysAgo})`),
      ),
    );
  return Number(row?.n ?? 0);
}

// ─── Report assembly (Decision E1 content contract) ──────────────────────────

export type CostLatencyReport = {
  windowDays: number;
  periodStart: Date;
  periodEnd: Date;
  /** Total priced spend this window. */
  totalUsd: number;
  /** Prior-window total, for the week-over-week delta. */
  prevTotalUsd: number;
  /** Trailing-30-day total, for context. */
  monthUsd: number;
  /** True if any surface this window contained an unpriced model. */
  anyUnpriced: boolean;
  surfaces: SurfaceCost[];
  latency: SurfaceLatency[];
  /** The slowest surface a human waits on live, by p95. Null if none timed. */
  slowestPlayerFacing: SurfaceLatency | null;
  questionsGenerated: number;
  answersGraded: number;
  costPerQuestionUsd: number | null;
  costPerAnswerGradedUsd: number | null;
};

/**
 * Assemble the full report from the telemetry. One builder feeds both the cron's
 * stored markdown and the live owner readout, so the two never drift.
 */
export async function buildCostLatencyReport(windowDays = 7): Promise<CostLatencyReport> {
  const now = new Date();
  const periodStart = new Date(now.getTime() - windowDays * 86_400_000);

  const [surfaces, prev, month, latency, questionsGenerated, answersGraded] = await Promise.all([
    readSurfaceCost(windowDays, 0),
    readSurfaceCost(windowDays * 2, windowDays),
    readSurfaceCost(30, 0),
    readSurfaceLatency(windowDays, 0),
    countQuestionsGenerated(windowDays),
    countAnswersGraded(windowDays),
  ]);

  const totalUsd = surfaces.reduce((a, s) => a + s.costUsd, 0);
  const prevTotalUsd = prev.reduce((a, s) => a + s.costUsd, 0);
  const monthUsd = month.reduce((a, s) => a + s.costUsd, 0);
  const anyUnpriced = surfaces.some((s) => s.unpriced);

  const sortedSurfaces = [...surfaces].sort((a, b) => b.costUsd - a.costUsd);

  const slowestPlayerFacing =
    latency
      .filter((l) => l.playerFacing && l.p95Ms != null)
      .sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0))[0] ?? null;

  const generateUsd = surfaces.find((s) => s.key === 'generate')?.costUsd ?? 0;
  const gradeUsd = surfaces.find((s) => s.key === 'grade')?.costUsd ?? 0;

  return {
    windowDays,
    periodStart,
    periodEnd: now,
    totalUsd,
    prevTotalUsd,
    monthUsd,
    anyUnpriced,
    surfaces: sortedSurfaces,
    latency,
    slowestPlayerFacing,
    questionsGenerated,
    answersGraded,
    costPerQuestionUsd: questionsGenerated > 0 ? generateUsd / questionsGenerated : null,
    costPerAnswerGradedUsd: answersGraded > 0 ? gradeUsd / answersGraded : null,
  };
}

// ─── Markdown rendering (the plain-English digest) ───────────────────────────

function usd(n: number | null): string {
  if (n == null) return 'unknown';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function deltaPhrase(curr: number, prev: number): string {
  if (prev <= 0) return curr > 0 ? 'no comparable spend last week' : 'flat versus last week';
  const change = (curr - prev) / prev;
  if (Math.abs(change) < 0.01) return 'about flat versus last week';
  const dir = change > 0 ? 'up' : 'down';
  return `${dir} ${pct(Math.abs(change))} from ${usd(prev)}`;
}

function ms(n: number | null): string {
  if (n == null) return '—';
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Render the report as the plain-English digest a non-engineer reads top to
 * bottom (Decision E1). Deliberately omits the "cheaper option" line (Decision
 * E2 — held back for separate ratification, as it edges toward recommendation).
 */
export function renderCostLatencyReportMarkdown(r: CostLatencyReport): string {
  const lines: string[] = [];

  lines.push(`# LLM cost & latency — ${fmtDate(r.periodStart)}–${fmtDate(r.periodEnd)}`);
  lines.push('');

  // Total + week-over-week.
  lines.push(`**Total spent this week: ${usd(r.totalUsd)}**, ${deltaPhrase(r.totalUsd, r.prevTotalUsd)}.`);
  lines.push('');
  lines.push(`Trailing 30 days: ${usd(r.monthUsd)}.`);
  lines.push('');

  // Spend by surface, biggest first.
  lines.push('## Where the money went');
  lines.push('');
  if (r.surfaces.length === 0) {
    lines.push('No LLM spend recorded this week.');
  } else {
    for (const s of r.surfaces) {
      const share = r.totalUsd > 0 ? ` (${pct(s.costUsd / r.totalUsd)})` : '';
      const flag = s.unpriced ? ' — includes an unpriced model, so this is a floor' : '';
      lines.push(`- **${s.label}: ${usd(s.costUsd)}**${share}${flag}`);
    }
  }
  lines.push('');

  // Cost per unit (only when a clean denominator exists, per O1).
  lines.push('## Cost per unit');
  lines.push('');
  if (r.costPerQuestionUsd != null) {
    lines.push(
      `- Cost per question generated: **${usd(r.costPerQuestionUsd)}** (${r.questionsGenerated.toLocaleString('en-US')} generated)`,
    );
  } else {
    lines.push('- Cost per question generated: no questions generated this week.');
  }
  if (r.costPerAnswerGradedUsd != null) {
    lines.push(
      `- Cost per answer graded: **${usd(r.costPerAnswerGradedUsd)}** (${r.answersGraded.toLocaleString('en-US')} graded by the model)`,
    );
  } else {
    lines.push('- Cost per answer graded: no answers were graded by the model this week.');
  }
  lines.push('');

  // Speed.
  lines.push('## How long players wait');
  lines.push('');
  if (r.slowestPlayerFacing) {
    const s = r.slowestPlayerFacing;
    lines.push(
      `Players wait longest on **${s.label.toLowerCase()}**: ~${ms(s.avgMs)} average, ~${ms(s.p95Ms)} at worst.`,
    );
  } else {
    lines.push('No timed player-facing calls this week.');
  }
  lines.push('');
  const timed = r.latency.filter((l) => l.calls > 0);
  if (timed.length > 0) {
    lines.push('| Surface | Avg | Worst (p95) |');
    lines.push('| --- | --- | --- |');
    for (const l of timed) {
      lines.push(`| ${l.label} | ${ms(l.avgMs)} | ${ms(l.p95Ms)} |`);
    }
    lines.push('');
  }

  // Unpriced callout — say it plainly rather than under-reporting.
  if (r.anyUnpriced) {
    lines.push('## Heads up');
    lines.push('');
    lines.push(
      'Some calls ran on a model with no price on file, so the dollar figures above are a floor — real spend is at least this much. Add the model to `src/server/llm/pricing.ts` to close the gap.',
    );
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

// ─── Storage (Decision B1) ───────────────────────────────────────────────────

export type StoredCostReport = {
  markdown: string;
  periodStart: Date;
  periodEnd: Date;
  windowDays: number;
  createdAt: Date;
};

/** Persist one rendered digest. Best-effort would defeat the cron, so this throws. */
export async function writeCostReport(r: CostLatencyReport, markdown: string): Promise<void> {
  await db.insert(llmCostReport).values({
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    windowDays: r.windowDays,
    markdown,
  });
}

// ─── Email recipient resolution (Decision B3) ────────────────────────────────

export type CostReportRecipient = {
  to: string;
  /** Where the address came from, for the cron's response + logs. */
  source: 'env' | 'admin_verified' | 'admin_unverified';
};

/**
 * Decide who the weekly digest emails to (the choice ratified for B3):
 *   1. LLM_COST_REPORT_EMAIL if set — an explicit override always wins.
 *   2. otherwise the email on the ADMIN_USER_IDS account — the same allowlist
 *      that gates the readout — preferring a verified address over an unverified
 *      one. No separate config needed for the common "email it to me" case.
 *
 * Returns null when nothing resolves (no override and no admin has an email on
 * file), so the cron skips the send and still stores its digest.
 */
export async function resolveCostReportRecipient(): Promise<CostReportRecipient | null> {
  const override = process.env.LLM_COST_REPORT_EMAIL?.trim();
  if (override) return { to: override, source: 'env' };

  const ids = adminUserIds();
  if (ids.length === 0) return null;

  const rows = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(and(inArray(users.id, ids), isNotNull(users.email)))
    // Prefer a verified address; among equals, the DB order is fine — one owner.
    .orderBy(desc(users.emailVerified));

  const row = rows.find((r) => r.email && r.email.trim());
  if (!row?.email) return null;
  return { to: row.email.trim(), source: row.emailVerified ? 'admin_verified' : 'admin_unverified' };
}

/** The most recently stored digest, or null if the cron has never run. */
export async function readLatestCostReport(): Promise<StoredCostReport | null> {
  const [row] = await db
    .select({
      markdown: llmCostReport.markdown,
      periodStart: llmCostReport.periodStart,
      periodEnd: llmCostReport.periodEnd,
      windowDays: llmCostReport.windowDays,
      createdAt: llmCostReport.createdAt,
    })
    .from(llmCostReport)
    .orderBy(desc(llmCostReport.createdAt))
    .limit(1);
  return row ?? null;
}
