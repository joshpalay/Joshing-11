// Supply backfill core — the inventory-build half of the supply model, shared by
// the CLI (scripts/backfill-supply.ts) and the nightly cron
// (/api/cron/backfill-supply). The JIT per-user demand path in
// generate-questions.ts is untouched; this pre-builds a demand-weighted BUFFER
// per demanded domain so that path increasingly serves from the bank.
//
// BALANCE: batch size is demand-weighted, not flat —
//   buffer_target = clamp(DAYS_RUNWAY × interested_users, BUFFER_FLOOR, effective_estimate)
//   batch         = ceil(max(0, buffer_target − have) / GATE_PASS_RATE), capped at BATCH_CAP
// Domains with no demand (0 declared interests) are skipped. Grounding routes to
// FANDOM domains only (fandom_host set) — measured 2026-07-10: a wash on canonical
// works the model knows (Hamlet 18 vs 17), decisive on thin fandoms (Spy School
// 0 vs 18).
import {
  ANTHROPIC_MODEL,
  HAIKU_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
} from '@/lib/llm';
import { db, pool, generatedQuestions } from '@/server/db';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseQuestions,
  findQualityFailures,
  findFactualFailures,
  type LlmQuestion,
} from '@/server/daily/generate-questions';
import { getReferencePassagesForDomains, type DomainReference } from '@/server/daily/domain-reference';
import { resolveDailyBasePoints } from '@/server/daily/types';
import { resolveMachineTrustTier } from '@/server/daily/ask-to-answer';
import { resolveFinestNode } from '@/server/knowledge/graph';
import { domainKey } from '@/lib/knowledge/domain-key';
import { normalizeFactKey } from '@/server/questions/fact-key';
import { estimateCostUsd } from '@/server/llm/pricing';

export interface BackfillOptions {
  /** true → compute + return the plan, make ZERO generation calls, persist nothing. */
  dryRun: boolean;
  /** Max domains to actually build this run (the neediest first). */
  limit: number;
  /** Restrict the whole pass to domain_keys matching this (case-insensitive) substring. */
  onlyDomain?: string | null;
  /** Owning user for persisted pool rows. Absent → generate but do NOT persist. */
  systemUserId?: string | null;
  daysRunway?: number;
  bufferFloor?: number;
  batchCap?: number;
}

const DEFAULTS = {
  daysRunway: Number(process.env.SUPPLY_BACKFILL_DAYS_RUNWAY ?? 14),
  bufferFloor: Number(process.env.SUPPLY_BACKFILL_BUFFER_FLOOR ?? 10),
  batchCap: Number(process.env.SUPPLY_BACKFILL_BATCH_CAP ?? 20),
};
const GATE_PASS_RATE = 0.85; // measured survivor rate through quality+factual
const GEN_TIMEOUT_MS = 150_000;
const GEN_MAX_TOKENS = 6000;
const DURABLE_EXPIRY = new Date('2999-01-01T00:00:00.000Z');
const ZERO_CACHE = { cacheReadTokens: 0, cacheCreateTokens: 0 };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export type BackfillPlan = {
  domainKey: string;
  label: string;
  interested: number;
  have: number;
  cap: number;
  bufferTarget: number;
  batch: number;
  ground: boolean;
  skipReason: string | null;
  estCostUsd: number;
};

export type BackfillReport = {
  dryRun: boolean;
  systemUser: boolean;
  domainsWithEstimate: number;
  actionableDomains: number;
  totalQuestionsPlanned: number;
  estCostUsd: number;
  plans: BackfillPlan[];
  built: { label: string; generated: number; persisted: number }[];
};

type DomainRow = {
  domain_key: string;
  sample_label: string | null;
  fandom_host: string | null;
  effective_est: number | null;
  have: number;
};

async function loadDemand(): Promise<Map<string, number>> {
  const rows = (await pool.query('SELECT "userId", domain FROM "DeclaredInterest" WHERE "isActive" = true')).rows as {
    userId: string;
    domain: string;
  }[];
  const byKey = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = domainKey(r.domain);
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k)!.add(r.userId);
  }
  return new Map([...byKey].map(([k, users]) => [k, users.size]));
}

async function loadDomains(onlyDomain?: string | null): Promise<DomainRow[]> {
  const where = onlyDomain ? 'WHERE d.domain_key ILIKE $1' : '';
  const params = onlyDomain ? [`%${onlyDomain.toLowerCase()}%`] : [];
  return (
    await pool.query(
      `SELECT d.domain_key, d.sample_label, d.fandom_host,
              COALESCE(d.manual_estimated_questions, d.estimated_questions) AS effective_est,
              (SELECT COUNT(*)::int FROM "GeneratedQuestion" g
                 WHERE g.domain_key = d.domain_key AND g.is_duplicate = false) AS have
       FROM "DomainDepthEstimate" d ${where}`,
      params,
    )
  ).rows as DomainRow[];
}

function estimateBatchCost(batch: number, ground: boolean): number {
  const gen = estimateCostUsd(ANTHROPIC_MODEL, { inputTokens: 5000, outputTokens: 150 * batch, ...ZERO_CACHE }).usd ?? 0;
  const quality = estimateCostUsd(HAIKU_MODEL, { inputTokens: 250 + 70 * batch, outputTokens: 120, ...ZERO_CACHE }).usd ?? 0;
  const factual = estimateCostUsd(ANTHROPIC_MODEL, { inputTokens: 350 + 90 * batch, outputTokens: 220, ...ZERO_CACHE }).usd ?? 0;
  const retrieval = ground
    ? estimateCostUsd(ANTHROPIC_MODEL, { inputTokens: 20000, outputTokens: 550, webSearchRequests: 1, ...ZERO_CACHE }).usd ?? 0
    : 0;
  return gen + quality + factual + retrieval;
}

export function buildPlan(
  domains: DomainRow[],
  demand: Map<string, number>,
  cfg: { daysRunway: number; bufferFloor: number; batchCap: number },
): BackfillPlan[] {
  const plans: BackfillPlan[] = [];
  for (const d of domains) {
    const label = d.sample_label || d.domain_key;
    const interested = demand.get(d.domain_key) ?? 0;
    const cap = d.effective_est ?? 0;
    const ground = Boolean(d.fandom_host);
    let bufferTarget = 0;
    let batch = 0;
    let skipReason: string | null = null;
    if (interested === 0) {
      skipReason = 'no demand (0 declared interests)';
    } else if (cap <= 0) {
      skipReason = 'no estimate';
    } else {
      bufferTarget = clamp(cfg.daysRunway * interested, cfg.bufferFloor, cap);
      const gap = Math.max(0, bufferTarget - d.have);
      batch = Math.min(cfg.batchCap, Math.ceil(gap / GATE_PASS_RATE));
      if (batch === 0) skipReason = `already stocked (have ${d.have} ≥ target ${bufferTarget})`;
    }
    plans.push({
      domainKey: d.domain_key,
      label,
      interested,
      have: d.have,
      cap,
      bufferTarget,
      batch,
      ground,
      skipReason,
      estCostUsd: batch > 0 ? estimateBatchCost(batch, ground) : 0,
    });
  }
  return plans.sort((a, b) => b.batch - a.batch || b.interested - a.interested);
}

async function generate(
  label: string,
  count: number,
  avoidTexts: { domain: string; text: string }[],
  avoidFks: { domain: string; factKey: string }[],
  references?: Map<string, DomainReference>,
): Promise<LlmQuestion[]> {
  const userPrompt = buildUserPrompt(
    [label], count,
    avoidTexts as never, avoidFks as never,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    references,
  );
  const client = getAnthropicClient();
  if (!client) throw new Error('no anthropic client');
  const res = await loggedMessagesCreate(client, 'backfill-supply-generate', {
    model: ANTHROPIC_MODEL,
    max_tokens: GEN_MAX_TOKENS,
    temperature: 0.8,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
  }, { timeoutMs: GEN_TIMEOUT_MS });
  return parseQuestions(extractTextContent(res.content));
}

async function loadAvoid(domainKeyVal: string): Promise<{
  texts: { domain: string; text: string }[];
  fks: { domain: string; factKey: string }[];
  factKeys: Set<string>;
}> {
  const rows = (
    await pool.query(
      'SELECT question_text, fact_key FROM "GeneratedQuestion" WHERE domain_key = $1 AND is_duplicate = false',
      [domainKeyVal],
    )
  ).rows as { question_text: string; fact_key: string | null }[];
  const factKeys = new Set<string>();
  const fks: { domain: string; factKey: string }[] = [];
  for (const r of rows) {
    const nk = normalizeFactKey(r.fact_key);
    if (nk) { factKeys.add(nk); fks.push({ domain: domainKeyVal, factKey: nk }); }
  }
  return { texts: rows.map((r) => ({ domain: domainKeyVal, text: r.question_text })), fks, factKeys };
}

async function buildDomain(p: BackfillPlan, systemUserId: string | null): Promise<{ generated: number; persisted: number }> {
  const avoid = await loadAvoid(p.domainKey);
  let refs: Map<string, DomainReference> | undefined;
  if (p.ground) refs = await getReferencePassagesForDomains([p.label]).catch(() => undefined);

  const generated = await generate(p.label, p.batch, avoid.texts, avoid.fks, refs);
  if (generated.length === 0) return { generated: 0, persisted: 0 };

  const [ql, fa] = await Promise.all([findQualityFailures(generated), findFactualFailures(generated)]);
  const seen = new Set(avoid.factKeys);
  const survivors: LlmQuestion[] = [];
  generated.forEach((q, i) => {
    if (ql.toDrop.has(i) || fa.toDrop.has(i)) return;
    const fk = normalizeFactKey(q.fact_key);
    if (fk && seen.has(fk)) return; // novelty vs bank + earlier in this batch
    if (fk) seen.add(fk);
    survivors.push(q);
  });

  if (!systemUserId) return { generated: generated.length, persisted: 0 };

  // Persist as unverified machine rows (mirrors the non-corroborated per-user
  // path). The batch-verify + embedding-dedup sweeps promote/dedupe them later.
  const trustTier = resolveMachineTrustTier({ askToAnswerVerified: false, corroborated: false });
  let persisted = 0;
  for (const q of survivors) {
    try {
      const taggedDomain = await resolveFinestNode(q.canonical_subcategory);
      await db.insert(generatedQuestions).values({
        userId: systemUserId,
        canonicalSubcategory: taggedDomain,
        domainKey: domainKey(taggedDomain),
        broadCategory: q.broad_category,
        questionText: q.question_text,
        answer: q.answer,
        explainer: q.explainer,
        difficultyEstimate: q.difficulty_estimate,
        basePoints: resolveDailyBasePoints(q.difficulty_estimate),
        factKey: normalizeFactKey(q.fact_key),
        subjectEntity: q.subject_entity,
        subAngles: q.sub_angles,
        trustTier,
        generatedByProvider: 'anthropic',
        expiresAt: DURABLE_EXPIRY,
        usedInQueue: false,
      });
      persisted += 1;
    } catch (err) {
      console.warn('[supply-backfill] persist failed', { domain: p.label, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { generated: generated.length, persisted };
}

export async function runSupplyBackfill(opts: BackfillOptions): Promise<BackfillReport> {
  const cfg = {
    daysRunway: opts.daysRunway ?? DEFAULTS.daysRunway,
    bufferFloor: opts.bufferFloor ?? DEFAULTS.bufferFloor,
    batchCap: opts.batchCap ?? DEFAULTS.batchCap,
  };
  const [demand, domains] = await Promise.all([loadDemand(), loadDomains(opts.onlyDomain)]);
  const plans = buildPlan(domains, demand, cfg);
  const actionable = plans.filter((p) => p.batch > 0);

  const report: BackfillReport = {
    dryRun: opts.dryRun,
    systemUser: Boolean(opts.systemUserId),
    domainsWithEstimate: domains.length,
    actionableDomains: actionable.length,
    totalQuestionsPlanned: actionable.reduce((s, p) => s + p.batch, 0),
    estCostUsd: Number(actionable.reduce((s, p) => s + p.estCostUsd, 0).toFixed(4)),
    plans,
    built: [],
  };
  if (opts.dryRun) return report;

  for (const p of actionable.slice(0, opts.limit)) {
    const r = await buildDomain(p, opts.systemUserId ?? null);
    report.built.push({ label: p.label, ...r });
  }
  return report;
}
