/** Pure frozen integration scheduler. No credentials, filesystem, database or provider client. */
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
import { sourceV3Schema } from './cassian-evidence-v3';
import {
  cardV4Schema,
  writerV4Schema,
  assessWriterV4,
  outputFormatV4,
  reconstructionInputV4,
  ACCEPTANCE_POLICY_V4,
  WRITER_COMMON_V4,
  WRITER_SOFT_V4,
  WRITER_STRICT_V4,
} from './cassian-evidence-v4';
import {
  qualityV4Schema,
  qualityInputV4,
  assessQualityV4,
  QUALITY_PROMPT_V4,
} from './cassian-quality-v4';
import { completenessPlanSchema, checkedPacketWriterInput } from './cassian-source-completeness';
import {
  inventoryReconciliationInput,
  inventoryCatalog,
  INVENTORY_RECONCILIATION_PROMPT,
} from './cassian-claim-reconciliation';
import {
  coverageSourceSchema,
  modelInventorySchema,
  assessCoverageSource,
  coverageInventoryCatalog,
  assessModelInventory,
  COVERAGE_SOURCE_PROMPT,
} from './cassian-coverage-protocol';
import type { PreparedPacket } from './cassian-source-packets';
import { estimateCostUsd } from '../src/server/llm/pricing';
export { hash, validateReceipt, receiptAction };
export type { Progress, Receipt };

const id = z.string().regex(/^[a-z0-9-]+$/),
  sha = z.string().regex(/^[a-f0-9]{64}$/);
export const coverageProbeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^cassian-coverage-probe-[a-z0-9-]+$/),
    seed: z.string().min(1),
    maxRunUsd: z.literal(1.1),
    timeoutMs: z.literal(60000),
    files: z.array(z.object({ path: z.string().min(1), sha }).strict()).min(1),
    priorDesignSha: sha,
    priorGoldSha: sha,
    coverageContractSha: sha,
    scope: z.literal('known-case-coverage-integration-not-production-reliability'),
    targets: z
      .array(
        z
          .object({
            slot: z.number().int().min(1).max(23),
            packet: z.custom<PreparedPacket>(),
            parents: z.array(sourceV3Schema),
            plan: completenessPlanSchema,
            blind: z.object({ soft: id, strict: id }).strict(),
          })
          .strict(),
      )
      .length(2),
    controls: z
      .array(
        z
          .object({
            privateId: id,
            card: cardV4Schema,
            sources: z.array(sourceV3Schema),
            domain: z.string().min(1),
            tier: z.enum(['accessible', 'moderate', 'specialist']),
          })
          .strict(),
      )
      .length(8),
    inventoryControls: z
      .array(
        z
          .object({
            privateId: id,
            card: cardV4Schema,
            packet: z.custom<PreparedPacket>(),
            sourceRaw: z.string().min(1),
            sourceOriginalRawSha: sha,
          })
          .strict(),
      )
      .length(2),
  })
  .strict();
export type CoverageDesign = z.infer<typeof coverageProbeSchema>;
export type CoverageJob = Job & {
  stage: 'writing' | 'source' | 'reconciliation' | 'quality';
  format: Anthropic.JSONOutputFormat;
};
const limits = {
  writing: { input: 14000, output: 3500 },
  source: { input: 14000, output: 4200 },
  reconciliation: { input: 10000, output: 2500 },
  quality: { input: 6500, output: 1600 },
} as const;
const formats = {
  writing: outputFormatV4(writerV4Schema),
  source: outputFormatV4(coverageSourceSchema),
  reconciliation: outputFormatV4(modelInventorySchema),
  quality: outputFormatV4(qualityV4Schema),
};
export function coverageParams(j: CoverageJob): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: j.model,
    max_tokens: j.maxOutputTokens,
    system: j.system,
    messages: [{ role: 'user', content: j.body }],
    output_config: {
      format: j.format,
      ...(j.stage === 'writing' ? { effort: 'low' as const } : {}),
    },
    thinking:
      j.stage === 'writing'
        ? { type: 'adaptive' }
        : ({ type: 'between_tools' } as unknown as Anthropic.ThinkingConfigParam),
  };
}
export const coverageBytes = (j: CoverageJob) =>
  Buffer.byteLength(JSON.stringify(coverageParams(j)), 'utf8');
const price = (model: string, input: number, output: number) =>
  estimateCostUsd(model, {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
  }).usd ?? Infinity;
function job(
  v: Omit<
    CoverageJob,
    'model' | 'maxInputTokens' | 'maxOutputTokens' | 'reserveUsd' | 'sha' | 'format'
  >,
): CoverageJob {
  const model = v.stage === 'writing' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5';
  const input =
    v.stage === 'source' && v.arm === 'control'
      ? Buffer.byteLength(v.body, 'utf8') > 15000
        ? 14500
        : 10000
      : limits[v.stage].input;
  const j = {
    ...v,
    model,
    maxInputTokens: input,
    maxOutputTokens: limits[v.stage].output,
    reserveUsd: price(model, input, limits[v.stage].output),
    format: formats[v.stage],
    sha: '',
  } as CoverageJob;
  const { sha: _sha, ...rest } = j;
  j.sha = hash(JSON.stringify({ job: rest, params: coverageParams(j) }));
  return j;
}
export function knownCoverageJobs(d: CoverageDesign): CoverageJob[] {
  const writers = d.targets.flatMap((t, n) =>
    (n % 2 ? ['strict', 'soft'] : ['soft', 'strict']).map((arm) =>
      job({
        key: `writer-${t.packet.requestId}-${arm}`,
        kind: 'writer',
        stage: 'writing',
        arm: arm as 'soft' | 'strict',
        requestId: t.packet.requestId,
        attempt: 0,
        system: WRITER_COMMON_V4 + '\n' + (arm === 'soft' ? WRITER_SOFT_V4 : WRITER_STRICT_V4),
        body: JSON.stringify({
          id: t.blind[arm as 'soft' | 'strict'],
          packet: JSON.parse(checkedPacketWriterInput(t.packet, t.parents, t.plan)),
          acceptancePolicy: ACCEPTANCE_POLICY_V4,
        }),
        bindings: [t.blind[arm as 'soft' | 'strict']],
        parents: [],
      }),
    ),
  );
  return [
    ...writers,
    ...d.controls.map((c) =>
      job({
        key: `source-${c.card.id}-control`,
        kind: 'factual',
        stage: 'source',
        arm: 'control',
        requestId: null,
        attempt: 0,
        system: COVERAGE_SOURCE_PROMPT,
        body: reconstructionInputV4(c.card, c.sources),
        bindings: [c.card.id],
        parents: [],
      }),
    ),
    ...d.inventoryControls.map((c) => {
      const built = inventoryCatalog(c.card, c.packet, c.sourceRaw, 'end_turn');
      if (!built.valid) throw Error('Invalid saved inventory control');
      return job({
        key: `reconcile-${c.card.id}-control`,
        kind: 'factual',
        stage: 'reconciliation',
        arm: 'control',
        requestId: null,
        attempt: 0,
        system: INVENTORY_RECONCILIATION_PROMPT,
        body: inventoryReconciliationInput(built.catalog, c.card),
        bindings: [c.card.id],
        parents: [],
      });
    }),
  ];
}
export function maximumCoverage(d: CoverageDesign) {
  const known = knownCoverageJobs(d);
  return {
    writers: 4,
    generatedSource: 4,
    controlSource: 8,
    reconciliation: 4,
    quality: 2,
    maximumCalls: 22,
    reserveUsd:
      known.reduce((n, j) => n + j.reserveUsd, 0) +
      4 * price('claude-sonnet-5-5', limits.source.input, limits.source.output) +
      2 * price('claude-sonnet-5-5', limits.reconciliation.input, limits.reconciliation.output) +
      2 * price('claude-sonnet-5-5', limits.quality.input, limits.quality.output),
  };
}
export function validateCoverageDesign(raw: unknown) {
  const d = coverageProbeSchema.parse(raw),
    paths = d.files.map((f) => f.path),
    ids = d.targets
      .flatMap((t) => [t.blind.soft, t.blind.strict])
      .concat(
        d.controls.map((c) => c.card.id),
        d.inventoryControls.map((c) => c.card.id),
      );
  if (
    new Set(paths).size !== paths.length ||
    paths.some(
      (p) =>
        p.includes('..') ||
        p.includes(':') ||
        p.includes('\\') ||
        (!/^(scripts|src|_scratch\/Cassian)\//.test(p) && p !== 'package-lock.json'),
    ) ||
    new Set(ids).size !== ids.length ||
    ids.some((v) => !id.safeParse(v).success) ||
    new Set(d.targets.map((t) => t.slot)).size !== 2 ||
    new Set(d.targets.map((t) => t.packet.requestId)).size !== 2 ||
    d.targets.some((t) => !id.safeParse(t.packet.requestId).success) ||
    new Set(d.controls.map((c) => c.privateId)).size !== 8 ||
    new Set(d.inventoryControls.map((c) => c.privateId)).size !== 2
  )
    throw Error('Invalid coverage design identities');
  for (const t of d.targets) checkedPacketWriterInput(t.packet, t.parents, t.plan);
  if (
    maximumCoverage(d).reserveUsd > d.maxRunUsd + 1e-9 ||
    knownCoverageJobs(d).some((j) => coverageBytes(j) > 40000)
  )
    throw Error('Coverage design exceeds frozen envelope');
  return d;
}
export function coverageJobs(d: CoverageDesign, p: Progress) {
  const known = knownCoverageJobs(d),
    writers = known.filter((j) => j.stage === 'writing');
  const cards = writers.flatMap((w) => {
    const t = d.targets.find((t) => t.packet.requestId === w.requestId)!,
      receipt = p.calls[w.key];
    const out = receipt
      ? assessWriterV4(
          receipt.raw,
          receipt.stopReason,
          t.packet,
          t.blind[w.arm as 'soft' | 'strict'],
          w.arm as 'soft' | 'strict',
        )
      : null;
    return out?.card ? [{ t, w, card: out.card }] : [];
  });
  const sources = cards.map(({ t, w, card }) =>
    job({
      key: `source-${card.id}-generated`,
      kind: 'factual',
      stage: 'source',
      arm: w.arm,
      requestId: w.requestId,
      attempt: 0,
      system: COVERAGE_SOURCE_PROMPT,
      body: reconstructionInputV4(card, t.packet.sources),
      bindings: [card.id],
      parents: [{ key: w.key, rawSha: p.calls[w.key].rawSha }],
    }),
  );
  const reconciliations = cards
    .filter((c) => c.w.arm === 'strict')
    .flatMap(({ t, w, card }) => {
      const s = sources.find((s) => s.bindings.includes(card.id))!,
        receipt = p.calls[s.key];
      const catalog = receipt
        ? coverageInventoryCatalog(receipt.raw, receipt.stopReason, card, t.packet).catalog
        : null;
      return catalog
        ? [
            job({
              key: `reconcile-${card.id}`,
              kind: 'factual',
              stage: 'reconciliation',
              arm: 'strict',
              requestId: w.requestId,
              attempt: 0,
              system: INVENTORY_RECONCILIATION_PROMPT,
              body: inventoryReconciliationInput(catalog, card),
              bindings: [card.id],
              parents: [
                { key: w.key, rawSha: p.calls[w.key].rawSha },
                { key: s.key, rawSha: receipt!.rawSha },
              ],
            }),
          ]
        : [];
    });
  const base = [...known, ...sources, ...reconciliations];
  if (!writers.every((w) => p.calls[w.key] || p.blocked[w.key])) return base;
  const items = [
    ...d.controls.map((c) => ({
      input: {
        id: c.card.id,
        question: c.card.question,
        answer: c.card.answer,
        domain: c.domain,
        tier: c.tier,
      },
      parent: null as CoverageJob | null,
    })),
    ...cards.map(({ t, w, card }) => ({
      input: {
        id: card.id,
        question: card.question,
        answer: card.answer,
        domain: t.packet.domain,
        tier: t.packet.tier as 'accessible' | 'moderate' | 'specialist',
      },
      parent: w,
    })),
  ].sort((a, b) =>
    hash(`${d.seed}:quality:${a.input.id}`).localeCompare(hash(`${d.seed}:quality:${b.input.id}`)),
  );
  const quality: CoverageJob[] = [];
  for (let n = 0; n < items.length; n += 6) {
    const batch = items.slice(n, n + 6);
    quality.push(
      job({
        key: `quality-coverage-${n / 6 + 1}`,
        kind: 'quality',
        stage: 'quality',
        arm: 'mixed',
        requestId: null,
        attempt: 0,
        system: QUALITY_PROMPT_V4,
        body: qualityInputV4(batch.map((i) => i.input)),
        bindings: batch.map((i) => i.input.id),
        parents: batch.flatMap((i) =>
          i.parent ? [{ key: i.parent.key, rawSha: p.calls[i.parent.key].rawSha }] : [],
        ),
      }),
    );
  }
  return [...base, ...quality];
}
export function validateCoverageProgress(d: CoverageDesign, p: Progress, designSha: string) {
  if (!p || !p.calls || !p.blocked) throw Error('Invalid coverage progress');
  const jobs = coverageJobs(d, p);
  if (new Set(jobs.map((j) => j.key)).size !== jobs.length) throw Error('Duplicate coverage job');
  for (const [key, r] of Object.entries(p.calls)) {
    const j = jobs.find((j) => j.key === key);
    if (!j) throw Error('Unknown coverage receipt');
    validateReceipt(r, j, designSha);
  }
  for (const [key, b] of Object.entries(p.blocked)) {
    const j = jobs.find((j) => j.key === key);
    if (!j || p.calls[key] || b.requestSha !== j.sha || !b.reason)
      throw Error('Invalid blocked coverage job');
  }
  if (jobs.length > 22 || jobs.reduce((n, j) => n + j.reserveUsd, 0) > d.maxRunUsd + 1e-9)
    throw Error('Materialized coverage cap exceeded');
  return jobs;
}
export function scoreCoverage(d: CoverageDesign, p: Progress, jobs: CoverageJob[]) {
  const quality = (id: string) => {
    const j = jobs.find((j) => j.stage === 'quality' && j.bindings.includes(id)),
      r = j && p.calls[j.key];
    return j && r
      ? assessQualityV4(r.raw, r.stopReason, JSON.parse(j.body).items).find((q) => q.id === id)
      : null;
  };
  const writers = d.targets.flatMap((t) =>
    (['soft', 'strict'] as const).map((arm) => {
      const receipt = p.calls[`writer-${t.packet.requestId}-${arm}`],
        out = receipt
          ? assessWriterV4(receipt.raw, receipt.stopReason, t.packet, t.blind[arm], arm)
          : null;
      const sourceReceipt = p.calls[`source-${t.blind[arm]}-generated`],
        inventoryReceipt = p.calls[`reconcile-${t.blind[arm]}`];
      const source =
        out?.card && sourceReceipt
          ? assessCoverageSource(
              sourceReceipt.raw,
              sourceReceipt.stopReason,
              out.card,
              t.packet.sources,
            )
          : null;
      const catalog =
        arm === 'strict' && out?.card && sourceReceipt
          ? coverageInventoryCatalog(
              sourceReceipt.raw,
              sourceReceipt.stopReason,
              out.card,
              t.packet,
            ).catalog
          : null;
      const inventory =
        catalog && inventoryReceipt
          ? assessModelInventory(inventoryReceipt.raw, inventoryReceipt.stopReason, catalog)
          : null;
      const q = quality(t.blind[arm]);
      return {
        slot: t.slot,
        requestId: t.packet.requestId,
        arm,
        writerStatus: out?.status ?? 'pending',
        writerIssues: out?.issues ?? [],
        card: out?.card ?? null,
        source,
        inventory,
        quality: q,
        machinePass:
          out?.status === 'candidate' &&
          !out.issues.length &&
          source?.decision === 'pass' &&
          q?.decision === 'pass' &&
          (arm === 'soft' || (inventory?.valid === true && inventory.result.complete)),
        notServingApproval: true,
      };
    }),
  );
  const controls = d.controls.map((c) => {
    const r = p.calls[`source-${c.card.id}-control`];
    return {
      id: c.privateId,
      blindId: c.card.id,
      source: r ? assessCoverageSource(r.raw, r.stopReason, c.card, c.sources) : null,
      quality: quality(c.card.id),
      notServingApproval: true,
    };
  });
  const inventoryControls = d.inventoryControls.map((c) => {
    const r = p.calls[`reconcile-${c.card.id}-control`],
      built = inventoryCatalog(c.card, c.packet, c.sourceRaw, 'end_turn');
    if (!built.valid) throw Error('Saved inventory control changed');
    return {
      id: c.privateId,
      blindId: c.card.id,
      inventory: r ? assessModelInventory(r.raw, r.stopReason, built.catalog) : null,
      notServingApproval: true,
    };
  });
  return { writers, controls, inventoryControls, scope: d.scope, notServingApproval: true };
}
