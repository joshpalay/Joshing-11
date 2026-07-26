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
  findAnswerLeaks,
  type LlmQuestion,
} from '@/server/daily/generate-questions';
import { getReferencePassagesForDomains, type DomainReference } from '@/server/daily/domain-reference';
import {
  coCalibrateLoweredEstimates,
  getReferenceRoutingHints,
  recordSupplyYieldObservation,
} from '@/server/db/queries/domain-depth-estimate';
import { resolveDailyBasePoints } from '@/server/daily/types';
import { resolveMachineTrustTier } from '@/server/daily/ask-to-answer';
import { resolveFinestNode } from '@/server/knowledge/graph';
import { dryRoundsThreshold, nearCompleteRatio } from '@/server/daily/supply-state';
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
  /**
   * Only backfill domains with PROVEN unmet demand — those a real player already
   * ran dry on (consecutive_dry_rounds ≥ dryK, the discrepancy signal). Default
   * true: a merely-declared domain that's still serving fine from its bank is not
   * worth spend at low scale. Set false (SUPPLY_BACKFILL_ONLY_DRY=false) for the
   * broader PREDICTIVE mode — pre-fill any servable-short declared domain before a
   * player hits the wall — once scale justifies the volume.
   */
  onlyDry?: boolean;
}

const DEFAULTS = {
  daysRunway: Number(process.env.SUPPLY_BACKFILL_DAYS_RUNWAY ?? 14),
  bufferFloor: Number(process.env.SUPPLY_BACKFILL_BUFFER_FLOOR ?? 10),
  batchCap: Number(process.env.SUPPLY_BACKFILL_BATCH_CAP ?? 20),
};

// Default ON: spend only where demand is UNMET (a domain went dry), not merely
// where interest was declared. Disable for predictive pre-fill at scale.
function isOnlyDryDefault(): boolean {
  const raw = process.env.SUPPLY_BACKFILL_ONLY_DRY?.trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
}
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
  /**
   * Rows owned by the SINGLE largest contributor to this domain. The bank serves
   * cross-user (pickBankSource: userId <> viewer), so a domain's neediest declarer
   * — usually its top contributor — can be served only `have − own_max` of its
   * rows; their own generations are excluded. Worst-case servable = have − own_max
   * is what the buffer must actually cover (the Zelda: TotK case, where one player
   * generated 13 of 16 rows and is served 3).
   */
  own_max: number;
  /** Consecutive offered-but-zero-yield generation rounds (the dry/discrepancy signal). */
  consecutive_dry_rounds: number;
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

// A corpus estimate at/above this (or any dedicated fandom wiki) marks a topic
// as genuinely RICH — kept in lockstep with the worklist's isRichTopic gate.
const RICH_CORPUS_ESTIMATE = 60;

// DEMONSTRATED demand: leaf nodes that are live mastery targets (a threshold is
// set — a player progresses through them) whose domain is RICH (fandom-backed or
// deep corpus). These are the Simpsons/HP-Book-3 class: real demand that arrives
// via a mastered PARENT, so no one declares the leaf directly, yet it must stay
// stocked. Gating on richness keeps genuinely-granular leaves OUT — those still
// want a human merge/shrink decision, not more generation. Returns folded keys.
async function loadDemonstratedDemand(): Promise<Set<string>> {
  const richRows = (await pool.query(
    'SELECT domain_key FROM "DomainDepthEstimate" WHERE fandom_host IS NOT NULL OR COALESCE(estimated_questions, 0) >= $1',
    [RICH_CORPUS_ESTIMATE],
  )).rows as { domain_key: string }[];
  const rich = new Set(richRows.map((r) => r.domain_key));
  const leafRows = (await pool.query(
    `SELECT label FROM "KnowledgeNode" WHERE node_kind = 'leaf' AND mastery_threshold IS NOT NULL`,
  )).rows as { label: string }[];
  const out = new Set<string>();
  for (const r of leafRows) {
    const k = domainKey(r.label);
    if (rich.has(k)) out.add(k);
  }
  return out;
}

async function loadDomains(onlyDomain?: string | null, systemUserId?: string | null): Promise<DomainRow[]> {
  // $1 = the system backfill user to EXCLUDE from own_max. Its bank rows serve to
  // EVERY real viewer (pickBackfill only excludes a viewer's OWN rows, and the
  // system user is never a viewer), so they are not part of any player's
  // worst-case self-owned stock. Counting them would make every domain the
  // backfill fills read as servable = have − system_owned ≈ its few non-system
  // rows — perpetually "dry to one user" — and re-generate it forever. An empty
  // string matches no real (uuid) user id, so an unset system user is a no-op.
  const sysExcl = (systemUserId ?? process.env.RETRIEVAL_SYSTEM_USER_ID)?.trim() || '';
  const params: string[] = [sysExcl];
  const where = onlyDomain ? 'WHERE d.domain_key ILIKE $2' : '';
  if (onlyDomain) params.push(`%${onlyDomain.toLowerCase()}%`);
  return (
    await pool.query(
      `SELECT d.domain_key, d.sample_label, d.fandom_host,
              COALESCE(d.manual_estimated_questions, d.estimated_questions) AS effective_est,
              (SELECT COUNT(*)::int FROM "GeneratedQuestion" g
                 WHERE g.domain_key = d.domain_key AND g.is_duplicate = false) AS have,
              COALESCE((SELECT MAX(cnt)::int FROM (
                 SELECT COUNT(*) AS cnt FROM "GeneratedQuestion" g2
                   WHERE g2.domain_key = d.domain_key AND g2.is_duplicate = false
                     AND g2.user_id <> $1
                   GROUP BY g2.user_id
              ) owner_counts), 0) AS own_max,
              COALESCE(d.consecutive_dry_rounds, 0) AS consecutive_dry_rounds
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
  cfg: { daysRunway: number; bufferFloor: number; batchCap: number; onlyDry?: boolean; dryK?: number },
): BackfillPlan[] {
  const onlyDry = cfg.onlyDry ?? true;
  const dryK = cfg.dryK ?? 3;
  const plans: BackfillPlan[] = [];
  for (const d of domains) {
    const label = d.sample_label || d.domain_key;
    const interested = demand.get(d.domain_key) ?? 0;
    const cap = d.effective_est ?? 0;
    const ground = Boolean(d.fandom_host);
    // Worst-case SERVABLE stock, not total inventory: the neediest interested
    // player is served only the rows they did NOT generate (bank excludes own
    // rows), so a domain one heavy player mined out reads as stocked to everyone
    // else yet dry to them. Gate the buffer on what that player can actually see.
    const servableHave = Math.max(0, d.have - d.own_max);
    let bufferTarget = 0;
    let batch = 0;
    let skipReason: string | null = null;
    if (interested === 0) {
      skipReason = 'no demand (0 declared interests)';
    } else if (cap <= 0) {
      skipReason = 'no estimate';
    } else if (onlyDry && d.consecutive_dry_rounds < dryK) {
      // Proven-demand gate: only spend where a player actually ran the domain dry
      // (the discrepancy signal), not merely where it was declared. A declared
      // domain still serving fine from its bank needs nothing.
      skipReason = `not exhausted (dry ${d.consecutive_dry_rounds} < ${dryK}); declared, not yet run dry`;
    } else {
      bufferTarget = clamp(cfg.daysRunway * interested, cfg.bufferFloor, cap);
      const gap = Math.max(0, bufferTarget - servableHave);
      batch = Math.min(cfg.batchCap, Math.ceil(gap / GATE_PASS_RATE));
      if (batch === 0) {
        skipReason = `already stocked (servable ${servableHave} ≥ target ${bufferTarget})`;
      }
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

async function buildDomain(
  p: BackfillPlan,
  systemUserId: string | null,
): Promise<{ generated: number; persisted: number; survivors: number; persistedKeys: string[] }> {
  const avoid = await loadAvoid(p.domainKey);
  let refs: Map<string, DomainReference> | undefined;
  if (p.ground) {
    // Layer 3 source routing: p.ground means this domain has a fandom_host, so
    // ground it from its IN-UNIVERSE CANON, not the Wikipedia-first default that
    // hands a deep fan domain a shallow game-as-product blurb (the Zelda: TotK
    // 1,200-est / 0-yield case). The routing hint carries the resolved host so the
    // search lands on the right wiki. Fail-open: a miss just means no reference.
    const hints = await getReferenceRoutingHints([p.domainKey]).catch(() => new Map());
    const hintByDomain = new Map([[p.label, hints.get(p.domainKey)]]);
    refs = await getReferencePassagesForDomains([p.label], hintByDomain).catch(() => undefined);
  }

  const generated = await generate(p.label, p.batch, avoid.texts, avoid.fks, refs);
  if (generated.length === 0) return { generated: 0, persisted: 0, survivors: 0, persistedKeys: [] };

  const [ql, fa] = await Promise.all([findQualityFailures(generated), findFactualFailures(generated)]);
  // Deterministic fail-closed backstop for the answer-leak case the Haiku
  // quality gate can miss (e.g. a title that itself names the answer, as in
  // "Rocko's Modern Life" → "Rocko"). generate-questions.ts's per-user path and
  // the retrieval-grounded refill (screenGroundedBatch) both already run this;
  // backfill-seeded bank rows are served indefinitely via verify-once-reuse-many
  // (pickBankPicksForDomains), so a miss here persists until someone notices it
  // live in a queue.
  const al = findAnswerLeaks(generated);
  const seen = new Set(avoid.factKeys);
  const survivors: LlmQuestion[] = [];
  generated.forEach((q, i) => {
    if (ql.toDrop.has(i) || fa.toDrop.has(i) || al.toDrop.has(i)) return;
    const fk = normalizeFactKey(q.fact_key);
    if (fk && seen.has(fk)) return; // novelty vs bank + earlier in this batch
    if (fk) seen.add(fk);
    survivors.push(q);
  });

  if (!systemUserId) {
    return { generated: generated.length, persisted: 0, survivors: survivors.length, persistedKeys: [] };
  }

  // Persist as unverified machine rows (mirrors the non-corroborated per-user
  // path). The batch-verify + embedding-dedup sweeps promote/dedupe them later.
  const trustTier = resolveMachineTrustTier({ askToAnswerVerified: false, corroborated: false });
  let persisted = 0;
  const persistedKeys: string[] = [];
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
      persistedKeys.push(domainKey(taggedDomain));
    } catch (err) {
      console.warn('[supply-backfill] persist failed', { domain: p.label, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { generated: generated.length, persisted, survivors: survivors.length, persistedKeys };
}

export async function runSupplyBackfill(opts: BackfillOptions): Promise<BackfillReport> {
  const cfg = {
    daysRunway: opts.daysRunway ?? DEFAULTS.daysRunway,
    bufferFloor: opts.bufferFloor ?? DEFAULTS.bufferFloor,
    batchCap: opts.batchCap ?? DEFAULTS.batchCap,
    onlyDry: opts.onlyDry ?? isOnlyDryDefault(),
    dryK: dryRoundsThreshold(),
  };
  const [demand, demonstrated, domains] = await Promise.all([
    loadDemand(),
    loadDemonstratedDemand(),
    loadDomains(opts.onlyDomain, opts.systemUserId),
  ]);
  // Fold DEMONSTRATED demand (rich mastery-path leaves) into the declared count:
  // a leaf nobody declared but a player is mastering counts as ≥1 interested, so
  // it earns a buffer instead of being skipped for "no demand".
  for (const key of demonstrated) demand.set(key, Math.max(demand.get(key) ?? 0, 1));
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
    report.built.push({ label: p.label, generated: r.generated, persisted: r.persisted });

    // Feed the supply-state machine from THIS path too. The dry-round counter
    // was written only by the per-user JIT round, so a domain the backfill
    // restocked every night still read "dry" forever (the 2026-07-13 email:
    // 10 alarmed domains, 5 of them refilled that same morning). Only the
    // production persisting run observes — a generate-only run adds no stock.
    if (opts.systemUserId) {
      try {
        if (r.persisted > 0) {
          // Credit the probed key AND the keys the rows actually landed on —
          // resolveFinestNode can retag a survivor to a finer node, and that
          // finer domain's counter deserves the reset too.
          await recordSupplyYieldObservation({
            yieldedDomainKeys: [p.domainKey, ...r.persistedKeys],
            dryDomainKeys: [],
          });
        } else if (r.generated > 0) {
          // A dedicated probe (domain alone, full avoid list, grounded when
          // possible) produced zero survivors — the strongest dry evidence.
          await recordSupplyYieldObservation({ yieldedDomainKeys: [], dryDomainKeys: [p.domainKey] });
          // Downward co-calibration: accept realized as ≈ the realizable size
          // so the domain rests as soft_finite instead of alarming forever.
          // Fandom-hosted and admin-overridden rows are excluded inside.
          await coCalibrateLoweredEstimates([p.domainKey], nearCompleteRatio());
        }
        // r.generated === 0 → the model/parse returned nothing at all; that is
        // an outage signal, not evidence about the domain — record nothing.
      } catch (err) {
        console.warn('[supply-backfill] yield observation failed (non-fatal)', {
          domain: p.label,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return report;
}
