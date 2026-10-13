/** Frozen saved-case checking only. No writer, credentials, filesystem, database or provider client. */
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import {
  hash,
  validateReceipt,
  receiptAction,
  type Job,
  type Progress,
  type Receipt,
} from './cassian-fresh-dispatch-core';
import {
  assessWriterV4,
  cardV4Schema,
  outputFormatV4,
  reconstructionInputV4,
} from './cassian-evidence-v4';
import { sourceV3Schema, validateSourceV3 } from './cassian-evidence-v3';
import { qualityInputV4, type QualityInputV4 } from './cassian-quality-v4';
import { coverageSourceSchema, assessCoverageSource } from './cassian-coverage-protocol';
import { cardScopeCatalog } from './cassian-card-scope';
import {
  modelScopeSchema,
  roleReviewSchema,
  scopeQualitySchema,
  modelScopeInput,
  assessModelScope,
  assessRoleReview,
  assessScopeQuality,
  SCOPE_SOURCE_PROMPT,
  SCOPE_RECONCILIATION_PROMPT,
  ROLE_PROMPT,
  SCOPE_QUALITY_PROMPT,
} from './cassian-scope-protocol';
import { estimateCostUsd } from '../src/server/llm/pricing';
import type { PreparedPacket } from './cassian-source-packets';
export { hash, validateReceipt, receiptAction };
export type { Progress, Receipt };
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const scopeProbeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^cassian-scope-probe-[a-z0-9-]+$/),
    seed: z.string().min(1),
    maxRunUsd: z.literal(1.35),
    timeoutMs: z.literal(60000),
    scope: z.literal('saved-scope-policy-integration-not-production-reliability'),
    priorDesignSha: sha,
    policyFreezeSha: sha,
    files: z.array(z.object({ path: z.string().min(1), sha }).strict()).min(1),
    cases: z
      .array(
        z
          .object({
            privateId: z.string().min(1),
            card: cardV4Schema,
            sources: z.array(sourceV3Schema),
            domain: z.string().min(1),
            tier: z.enum(['accessible', 'moderate', 'specialist']),
            relationRequired: z.boolean(),
            packet: z.custom<PreparedPacket>().nullable(),
          })
          .strict(),
      )
      .length(12),
  })
  .strict();
export type ScopeDesign = z.infer<typeof scopeProbeSchema>;
export type ScopeJob = Job & {
  stage: 'source' | 'scope' | 'relation' | 'quality';
  format: Anthropic.JSONOutputFormat;
};
const limits = {
  source: { input: 14500, output: 4200 },
  scope: { input: 12000, output: 4000 },
  relation: { input: 14500, output: 2200 },
  quality: { input: 8000, output: 2000 },
};
const formats = {
  source: outputFormatV4(coverageSourceSchema),
  scope: outputFormatV4(modelScopeSchema),
  relation: outputFormatV4(roleReviewSchema),
  quality: outputFormatV4(scopeQualitySchema),
};
export const scopeParams = (j: ScopeJob): Anthropic.MessageCreateParamsNonStreaming => ({
  model: j.model,
  max_tokens: j.maxOutputTokens,
  system: j.system,
  messages: [{ role: 'user', content: j.body }],
  output_config: { format: j.format },
  thinking: { type: 'between_tools' } as unknown as Anthropic.ThinkingConfigParam,
});
export const scopeBytes = (j: ScopeJob) =>
  Buffer.byteLength(JSON.stringify(scopeParams(j)), 'utf8');
const reserve = (stage: ScopeJob['stage']) =>
  estimateCostUsd('claude-sonnet-5-5', {
    inputTokens: limits[stage].input,
    outputTokens: limits[stage].output,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
  }).usd ?? Infinity;
function job(
  v: Omit<
    ScopeJob,
    'sha' | 'format' | 'model' | 'maxInputTokens' | 'maxOutputTokens' | 'reserveUsd'
  >,
): ScopeJob {
  const j = {
    ...v,
    sha: '',
    format: formats[v.stage],
    model: 'claude-sonnet-5-5' as const,
    maxInputTokens: limits[v.stage].input,
    maxOutputTokens: limits[v.stage].output,
    reserveUsd: reserve(v.stage),
  };
  const { sha: _sha, ...rest } = j;
  j.sha = hash(JSON.stringify({ job: rest, params: scopeParams(j) }));
  return j;
}
const qi = (c: ScopeDesign['cases'][number]): QualityInputV4 => ({
  id: c.card.id,
  question: c.card.question,
  answer: c.card.answer,
  domain: c.domain,
  tier: c.tier,
});
export function knownScopeJobs(d: ScopeDesign): ScopeJob[] {
  const base = d.cases.map((c) =>
    job({
      key: 'source-' + c.card.id,
      kind: 'factual',
      stage: 'source',
      arm: 'mixed',
      requestId: null,
      attempt: 0,
      system: SCOPE_SOURCE_PROMPT,
      body: reconstructionInputV4(c.card, c.sources),
      bindings: [c.card.id],
      parents: [],
    }),
  );
  const relations = d.cases
    .filter((c) => c.relationRequired)
    .map((c) =>
      job({
        key: 'relation-' + c.card.id,
        kind: 'factual',
        stage: 'relation',
        arm: 'mixed',
        requestId: null,
        attempt: 0,
        system: ROLE_PROMPT,
        body: reconstructionInputV4(c.card, c.sources),
        bindings: [c.card.id],
        parents: [],
      }),
    );
  const items = d.cases
    .map(qi)
    .sort((a, b) =>
      hash(d.seed + ':quality:' + a.id).localeCompare(hash(d.seed + ':quality:' + b.id)),
    );
  const quality = [0, 6].map((n, i) =>
    job({
      key: 'quality-scope-' + (i + 1),
      kind: 'quality',
      stage: 'quality',
      arm: 'mixed',
      requestId: null,
      attempt: 0,
      system: SCOPE_QUALITY_PROMPT,
      body: qualityInputV4(items.slice(n, n + 6)),
      bindings: items.slice(n, n + 6).map((i) => i.id),
      parents: [],
    }),
  );
  return [...base, ...relations, ...quality];
}
export function maximumScope(d: ScopeDesign) {
  return {
    source: 12,
    scope: d.cases.filter((c) => c.packet).length,
    relation: d.cases.filter((c) => c.relationRequired).length,
    quality: 2,
    maximumCalls: 21,
    reserveUsd: knownScopeJobs(d).reduce((n, j) => n + j.reserveUsd, 0) + 4 * reserve('scope'),
  };
}
export function validateScopeDesign(raw: unknown) {
  const d = scopeProbeSchema.parse(raw);
  const paths = d.files.map((f) => f.path);
  if (
    new Set(paths).size !== paths.length ||
    paths.some(
      (p) =>
        p.includes('..') ||
        p.includes(':') ||
        p.includes('\\') ||
        (!/^(scripts|src|_scratch\/Cassian)\//.test(p) && p !== 'package-lock.json'),
    )
  )
    throw Error('Invalid frozen pin paths');
  if (
    new Set(d.cases.map((c) => c.card.id)).size !== 12 ||
    new Set(d.cases.map((c) => c.privateId)).size !== 12 ||
    d.cases.some((c) => !/^item-[a-f0-9]{16}$/.test(c.card.id)) ||
    d.cases.filter((c) => c.packet).length !== 4 ||
    d.cases.filter((c) => c.relationRequired).length !== 3
  )
    throw Error('Invalid frozen case frame');
  for (const c of d.cases) {
    for (const s of c.sources) validateSourceV3(s);
    if (c.packet && JSON.stringify(c.packet.sources) !== JSON.stringify(c.sources))
      throw Error('Scope packet sources changed');
    if (c.packet) {
      const writer = assessWriterV4(
        JSON.stringify({ status: 'candidate', reason: '', card: c.card }),
        'end_turn',
        c.packet,
        c.card.id,
        'strict',
      );
      if (writer.status !== 'candidate' || writer.issues.length)
        throw Error('Invalid saved inventory');
    }
    if (new Set(c.sources.map((s) => s.id)).size !== c.sources.length)
      throw Error('Duplicate source');
  }
  if (
    maximumScope(d).reserveUsd > d.maxRunUsd + 1e-9 ||
    knownScopeJobs(d).some((j) => scopeBytes(j) > 40000)
  )
    throw Error('Frozen scope cap/envelope exceeded');
  return d;
}
export function scopeJobs(d: ScopeDesign, p: Progress) {
  const base = knownScopeJobs(d);
  const scopes = d.cases.flatMap((c) => {
    const r = p.calls['source-' + c.card.id];
    if (!r || !c.packet) return [];
    let catalog;
    try {
      catalog = cardScopeCatalog(c.card, c.packet, r.raw, r.stopReason);
    } catch {
      return [];
    }
    return [
      job({
        key: 'scope-' + c.card.id,
        kind: 'factual',
        stage: 'scope',
        arm: 'mixed',
        requestId: null,
        attempt: 0,
        system: SCOPE_RECONCILIATION_PROMPT,
        body: modelScopeInput(catalog),
        bindings: [c.card.id],
        parents: [{ key: r.key, rawSha: r.rawSha }],
      }),
    ];
  });
  return [...base, ...scopes];
}
export function validateScopeProgress(d: ScopeDesign, p: Progress, designSha: string) {
  if (!p || !p.calls || !p.blocked) throw Error('Invalid scope progress');
  const jobs = scopeJobs(d, p);
  if (new Set(jobs.map((j) => j.key)).size !== jobs.length) throw Error('Duplicate scope job');
  for (const [key, r] of Object.entries(p.calls)) {
    const j = jobs.find((j) => j.key === key);
    if (!j) throw Error('Unknown scope receipt');
    validateReceipt(r, j, designSha);
  }
  for (const [key, b] of Object.entries(p.blocked)) {
    const j = jobs.find((j) => j.key === key);
    if (!j || p.calls[key] || b.requestSha !== j.sha || !b.reason)
      throw Error('Invalid blocked scope job');
  }
  if (jobs.length > 21 || jobs.reduce((n, j) => n + j.reserveUsd, 0) > d.maxRunUsd + 1e-9)
    throw Error('Materialized scope cap exceeded');
  return jobs;
}
export function scoreScope(d: ScopeDesign, p: Progress, jobs: ScopeJob[]) {
  return d.cases.map((c) => {
    const r = p.calls['source-' + c.card.id],
      s = p.calls['scope-' + c.card.id],
      role = p.calls['relation-' + c.card.id],
      q = jobs.find((j) => j.stage === 'quality' && j.bindings.includes(c.card.id)),
      qr = q && p.calls[q.key];
    const source = r ? assessCoverageSource(r.raw, r.stopReason, c.card, c.sources) : null;
    let scope = null;
    if (r && s && c.packet) {
      try {
        scope = assessModelScope(
          s.raw,
          s.stopReason,
          cardScopeCatalog(c.card, c.packet, r.raw, r.stopReason),
        );
      } catch {
        scope = null;
      }
    }
    const relation = role ? assessRoleReview(role.raw, role.stopReason, c.card, c.sources) : null;
    const quality =
      q && qr
        ? (assessScopeQuality(qr.raw, qr.stopReason, JSON.parse(q.body).items).find(
            (i) => i.id === c.card.id,
          ) ?? null)
        : null;
    const effectiveSource =
      source?.decision === 'hold' || relation?.decision === 'hold'
        ? 'hold'
        : source?.decision === 'pass' && (!c.relationRequired || relation?.decision === 'pass')
          ? 'pass'
          : 'review';
    return {
      id: c.privateId,
      blindId: c.card.id,
      source,
      scope,
      relation,
      quality,
      effectiveSource,
      machinePass:
        effectiveSource === 'pass' &&
        quality?.decision === 'pass' &&
        (!c.packet || (scope?.valid === true && scope.result.complete)),
      notServingApproval: true,
    };
  });
}
