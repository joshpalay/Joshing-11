/** Offline targeted-review policy. No clients, credentials, database or serving imports. */
import { createHash } from 'node:crypto';
import { z } from 'zod';

const identity = z.string().regex(/^[a-z0-9-]+$/);
const screening = z.object({ decision: z.enum(['pass', 'hold', 'invalid']), reason: z.string().optional() }).strict();
const source = z.object({ id: identity, text: z.string().min(1).max(20000) }).strict();
export const targetedItemSchema = z.object({
  id: identity, question: z.string().min(1), answer: z.string().min(1), variants: z.array(z.string().min(1)),
  explanation: z.string().min(1), domain: z.string().min(1), tier: z.string().min(1), factKey: z.string().nullable(),
  novelty: z.enum(['eligible', 'excluded', 'unknown']), sources: z.array(source).min(1),
  screen: z.object({ quality: screening, factual: screening }).strict(),
  writer: z.enum(['sonnet', 'haiku']), expectedUsable: z.boolean(), ownerGood: z.boolean().nullable(), policySensitive: z.boolean(),
  historical: z.object({ writerUsd: z.number().nonnegative(), qualityUsd: z.number().nonnegative(),
    factualUsd: z.number().nonnegative(), writerMs: z.number().nonnegative(), qualityMs: z.number().nonnegative(),
    factualMs: z.number().nonnegative() }).strict(),
}).strict();
export type TargetedItem = z.infer<typeof targetedItemSchema>;
export const targetedManifestSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^cassian-[a-z0-9-]+$/), maxRunUsd: z.number().positive().max(0.75),
  seed: z.string().min(1), passAuditFraction: z.number().min(0).max(1),
  models: z.object({ quality: z.literal('claude-sonnet-5-5'), factual: z.literal('claude-sonnet-5-5') }).strict(),
  requestSettings: z.object({ maxTokens: z.literal(3000), timeoutMs: z.literal(30000), maxRetries: z.literal(0) }).strict(),
  requestHashes: z.array(z.object({ key: z.string().min(1), sha: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(16),
  prompts: z.object({ quality: z.string().min(1), factual: z.string().min(1) }).strict(),
  batches: z.array(z.object({ id: identity, items: z.array(targetedItemSchema).min(1).max(6) }).strict()).min(1).max(8),
}).strict();
export type TargetedManifest = z.infer<typeof targetedManifestSchema>;
export type Decision = 'pass' | 'hold' | 'review';
export type ReviewReply = { raw: string; usd: number; elapsedMs: number; model: string; requestId?: string | null; stopReason?: string | null;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number } };
export type ReviewStep = { key: string; kind: 'quality' | 'factual'; ids: string[]; body: string };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const normalized = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function assertReviewBudgetClear(reservedUsd: number, carriedUncertaintyUsd = 0, ownReservedUsd = 0): void {
  if ([reservedUsd, carriedUncertaintyUsd, ownReservedUsd].some(n => !Number.isFinite(n) || n < 0) ||
    ownReservedUsd !== 0 || Math.abs(reservedUsd - carriedUncertaintyUsd) > 1e-9)
    throw new Error('Active, same-run or unaccounted reservation; stop before dispatch.');
}

export function targetedRequestHashes(manifest: TargetedManifest): { key: string; sha: string }[] {
  return planTargetedReview(manifest).map(step => ({ key: step.key,
    sha: hash(JSON.stringify({ ...step, model: manifest.models[step.kind], prompt: manifest.prompts[step.kind], settings: manifest.requestSettings })) }));
}

/** Same explicit fact or question is a duplicate; do not guess semantic novelty from names. */
export function codeFindings(items: TargetedItem[]): Map<string, string[]> {
  const findings = new Map<string, string[]>();
  const questions = new Set<string>();
  const facts = new Set<string>();
  for (const item of items) {
    const issues: string[] = [];
    if (!item.question.trim() || !item.answer.trim()) issues.push('empty_text');
    if (item.novelty === 'excluded') issues.push('known_novelty_exclusion');
    const question = normalized(item.question);
    const fact = item.factKey?.trim();
    if (questions.has(question) || (fact && facts.has(fact))) issues.push('duplicate');
    questions.add(question);
    if (fact) facts.add(fact);
    findings.set(item.id, issues);
  }
  return findings;
}

export function validateTargetedManifest(raw: unknown): TargetedManifest {
  const manifest = targetedManifestSchema.parse(raw);
  const items = manifest.batches.flatMap(b => b.items);
  if (new Set(items.map(i => i.id)).size !== items.length ||
    new Set(manifest.batches.map(b => b.id)).size !== manifest.batches.length ||
    items.some(i => new Set(i.sources.map(s => s.id)).size !== i.sources.length)) {
    throw new Error('Duplicate manifest identity.');
  }
  const steps = planTargetedReview(manifest);
  if (JSON.stringify(manifest.requestHashes) !== JSON.stringify(targetedRequestHashes(manifest)))
    throw new Error('Frozen review requests changed; prepare a new manifest.');
  if (steps.some(s => s.body.length + manifest.prompts[s.kind].length > 50000))
    throw new Error('Review request exceeds the frozen input-size limit.');
  return manifest;
}

export function planTargetedReview(manifest: TargetedManifest): ReviewStep[] {
  const findings = codeFindings(manifest.batches.flatMap(b => b.items));
  return manifest.batches.flatMap(batch => {
    const active = batch.items.filter(i => !findings.get(i.id)!.length);
    const passes = active.filter(i => i.screen.quality.decision === 'pass')
      .map(item => ({ item, rank: parseInt(hash(`${manifest.seed}:${item.id}`).slice(0, 8), 16) / 0x100000000 }))
      .sort((a, b) => a.rank - b.rank || a.item.id.localeCompare(b.item.id));
    const audited = new Set(passes.filter(p => p.rank < manifest.passAuditFraction).map(p => p.item.id));
    // Audit at least one pass in each eligible batch when sampling is enabled.
    if (manifest.passAuditFraction > 0 && passes.length) audited.add(passes[0].item.id);
    const quality = active.filter(i => i.screen.quality.decision !== 'pass' || audited.has(i.id));
    const steps: ReviewStep[] = [];
    if (quality.length) steps.push({ key: `quality:${batch.id}`, kind: 'quality', ids: quality.map(i => i.id),
      body: JSON.stringify({ items: quality.map(i => ({ id: i.id, question: i.question, answer: i.answer,
        variants: i.variants, domain: i.domain, tier: i.tier })) }) });
    if (active.length) steps.push({ key: `factual:${batch.id}`, kind: 'factual', ids: active.map(i => i.id),
      body: JSON.stringify({ items: active.map(i => ({ id: i.id, question: i.question, answer: i.answer,
        explanation: i.explanation, sources: i.sources })) }) });
    return steps;
  });
}

const defect = z.enum(['OPINION_OR_VAGUE', 'FALSE_PREMISE', 'GENERIC_AT_TIER', 'MULTI_PART', 'MISLEADING_SETUP', 'OFF_DOMAIN']);
const quoteText = z.string().min(1).refine(text => text.trim().length > 0, 'Evidence cannot be whitespace.');
const qualityAssessment = z.object({ id: identity, requestedFact: z.string().min(1), uncertain: z.boolean(),
  disclosure: z.object({ kind: z.enum(['literal', 'semantic']), quote: quoteText, explanation: z.string().min(1) }).strict().nullable(),
  requestGroups: z.array(z.object({ quote: quoteText, attribute: z.string().min(1) }).strict()).min(1),
  otherDefects: z.array(z.object({ code: defect, quote: quoteText, explanation: z.string().min(1) }).strict()),
}).strict();
const evidence = z.object({ sourceId: identity, quote: quoteText }).strict();
const fieldAssessment = z.object({ status: z.enum(['supported', 'contradicted', 'unknown']),
  evidence: z.array(evidence), explanation: z.string().min(1) }).strict();
const factualAssessment = z.object({ id: identity, question: fieldAssessment, answer: fieldAssessment,
  explanation: fieldAssessment }).strict();
type QualityAssessment = z.infer<typeof qualityAssessment>;
type FactualAssessment = z.infer<typeof factualAssessment>;

/** Output must be JSON (optional fences). Extra prose, IDs or omitted items require review. */
function parseAssessments<T extends { id: string }>(raw: string, ids: string[], schema: z.ZodType<T>): T[] | null {
  try {
    const parsed = z.object({ items: z.array(schema) }).strict().parse(JSON.parse(raw.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
    return parsed.items.length === ids.length && new Set(parsed.items.map(i => i.id)).size === ids.length &&
      parsed.items.every(i => ids.includes(i.id)) ? parsed.items : null;
  } catch { return null; }
}

export function qualityDecision(item: Pick<TargetedItem, 'question' | 'answer' | 'variants'>, assessment: QualityAssessment): { decision: Decision; issues: string[] } {
  const issues: string[] = [];
  const quotes = [...assessment.requestGroups.map(g => g.quote), ...assessment.otherDefects.map(d => d.quote),
    ...(assessment.disclosure ? [assessment.disclosure.quote] : [])];
  if (quotes.some(q => !item.question.includes(q))) issues.push('evidence_not_in_question');
  if (assessment.disclosure?.kind === 'literal' && ![item.answer, ...item.variants].some(answer =>
    normalized(answer).length > 0 && ` ${normalized(assessment.disclosure!.quote)} `.includes(` ${normalized(answer)} `)))
    issues.push('literal_evidence_does_not_print_answer');
  if (assessment.otherDefects.some(d => d.code === 'MULTI_PART') &&
    (new Set(assessment.requestGroups.map(g => g.quote)).size < 2 ||
      new Set(assessment.requestGroups.map(g => normalized(g.attribute))).size < 2)) issues.push('multipart_groups_not_distinct');
  if (assessment.uncertain) issues.push('quality_uncertain');
  return { decision: issues.length ? 'review' : assessment.disclosure || assessment.otherDefects.length ? 'hold' : 'pass', issues };
}

export function factualDecision(item: Pick<TargetedItem, 'sources'>, assessment: FactualAssessment): { decision: Decision; issues: string[] } {
  const issues: string[] = [];
  const sources = new Map(item.sources.map(s => [s.id, s.text]));
  const fields = [assessment.question, assessment.answer, assessment.explanation];
  for (const field of fields) {
    if (field.status !== 'unknown' && !field.evidence.length) issues.push('missing_source_evidence');
    if (field.evidence.some(e => !sources.get(e.sourceId)?.includes(e.quote))) issues.push('evidence_not_in_sources');
  }
  if (issues.length) return { decision: 'review', issues };
  if (fields.some(f => f.status === 'contradicted')) return { decision: 'hold', issues: ['source_contradiction'] };
  if (fields.some(f => f.status === 'unknown')) return { decision: 'review', issues: ['source_support_unknown'] };
  return { decision: 'pass', issues };
}

/** Same strict assessment contract for offline controls and generated cards, without invented writer labels. */
export function assessReviewReply(kind: 'quality' | 'factual', items: Pick<TargetedItem, 'id' | 'question' | 'answer' | 'variants' | 'sources'>[], reply: ReviewReply | undefined) {
  const ids = items.map(i => i.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate review input IDs.');
  const assessments = !reply || reply.stopReason !== 'end_turn' ? null : kind === 'quality'
    ? parseAssessments(reply.raw, ids, qualityAssessment) : parseAssessments(reply.raw, ids, factualAssessment);
  return items.map(item => {
    const a = assessments?.find(x => x.id === item.id);
    const result = !a ? { decision: 'review' as const, issues: [reply ? 'invalid_review_response' : 'review_not_run'] }
      : kind === 'quality' ? qualityDecision(item, a as QualityAssessment) : factualDecision(item, a as FactualAssessment);
    return { id: item.id, ...result };
  });
}

export function scoreTargetedReview(manifest: TargetedManifest, replies: Record<string, ReviewReply>) {
  const items = manifest.batches.flatMap(b => b.items);
  const findings = codeFindings(items);
  const steps = planTargetedReview(manifest);
  if (Object.keys(replies).some(key => !steps.some(s => s.key === key))) throw new Error('Checkpoint has an unknown call.');
  const quality = new Map<string, { decision: Decision; issues: string[] }>();
  const factual = new Map<string, { decision: Decision; issues: string[] }>();
  for (const step of steps) {
    const reply = replies[step.key];
    const assessments = !reply || (reply.stopReason && reply.stopReason !== 'end_turn') ? null : step.kind === 'quality'
      ? parseAssessments(reply.raw, step.ids, qualityAssessment) : parseAssessments(reply.raw, step.ids, factualAssessment);
    for (const id of step.ids) {
      const item = items.find(i => i.id === id)!;
      const assessment = assessments?.find(a => a.id === id);
      const result = !assessment ? { decision: 'review' as const, issues: [reply ? 'invalid_review_response' : 'review_not_run'] }
        : step.kind === 'quality' ? qualityDecision(item, assessment as QualityAssessment)
          : factualDecision(item, assessment as FactualAssessment);
      (step.kind === 'quality' ? quality : factual).set(id, result);
    }
  }
  const rows = items.map(item => {
    const code = findings.get(item.id)!;
    const baseline: Decision = code.length || item.screen.quality.decision === 'hold' || item.screen.factual.decision === 'hold'
      ? 'hold' : item.novelty === 'unknown' || Object.values(item.screen).some(s => s.decision === 'invalid') ? 'review' : 'pass';
    const q = quality.get(item.id) ?? { decision: 'pass' as const, issues: [] };
    const f = factual.get(item.id) ?? { decision: 'review' as const, issues: ['review_not_run'] };
    const candidate: Decision = code.length || q.decision === 'hold' || f.decision === 'hold' ? 'hold'
      : item.novelty === 'unknown' || q.decision === 'review' || f.decision === 'review' ? 'review' : 'pass';
    const qStep = steps.find(s => s.kind === 'quality' && s.ids.includes(item.id));
    const fStep = steps.find(s => s.kind === 'factual' && s.ids.includes(item.id));
    const candidateMs = code.length ? item.historical.writerMs : !fStep || !replies[fStep.key] || (qStep && !replies[qStep.key]) ? null
      : item.historical.writerMs + Math.max(item.historical.qualityMs + (qStep ? replies[qStep.key].elapsedMs : 0), replies[fStep.key].elapsedMs);
    return { id: item.id, writer: item.writer, expectedUsable: item.expectedUsable, ownerGood: item.ownerGood, policySensitive: item.policySensitive, baseline, candidate,
      modeledBaselineMs: item.historical.writerMs + Math.max(item.historical.qualityMs, item.historical.factualMs), modeledCandidateMs: candidateMs,
      qualityAudited: quality.has(item.id), quality: q, factual: f, code };
  });
  const complete = steps.every(s => !!replies[s.key]);
  const groups = (['sonnet', 'haiku'] as const).flatMap(writer => (['baseline', 'candidate'] as const).map(pipeline => {
    const subset = rows.filter(r => r.writer === writer);
    const selected = items.filter(i => i.writer === writer);
    const usd = pipeline === 'baseline' ? selected.reduce((s, i) => s + i.historical.writerUsd + i.historical.qualityUsd + i.historical.factualUsd, 0)
      : !complete ? null : selected.reduce((s, i) => s + i.historical.writerUsd + i.historical.qualityUsd, 0) +
        steps.reduce((s, step) => s + replies[step.key].usd * step.ids.filter(id => selected.some(i => i.id === id)).length / step.ids.length, 0);
    const usable = subset.filter(r => r[pipeline] === 'pass' && r.expectedUsable).length;
    return { writer, pipeline, attempts: subset.length, verifiedUsablePasses: usable,
      ownerGoodAndVerifiedPasses: subset.filter(r => r[pipeline] === 'pass' && r.expectedUsable && r.ownerGood).length,
      nonKeepPasses: subset.filter(r => r[pipeline] === 'pass' && !r.expectedUsable).length,
      nonKeepPassesExcludingPolicy: subset.filter(r => r[pipeline] === 'pass' && !r.expectedUsable && !r.policySensitive).length,
      goodHolds: subset.filter(r => r[pipeline] === 'hold' && r.expectedUsable).length,
      goodUnresolved: subset.filter(r => r[pipeline] === 'review' && r.expectedUsable).length,
      unresolved: subset.filter(r => r[pipeline] === 'review').length, attributedUsd: usd,
      meanModeledCoreMs: !subset.length ? null : pipeline === 'baseline' ? subset.reduce((s, r) => s + r.modeledBaselineMs, 0) / subset.length
        : complete ? subset.reduce((s, r) => s + (r.modeledCandidateMs ?? 0), 0) / subset.length : null,
      usdPerVerifiedUsable: usd === null || !usable ? null : usd / usable };
  }));
  return { complete, plannedCalls: steps.length, completedCalls: Object.keys(replies).length,
    reviewItems: steps.filter(s => s.kind === 'quality').reduce((s, step) => s + step.ids.length, 0), rows, groups };
}
