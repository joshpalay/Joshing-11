/** Offline source preparation. Explicit required passages, never fixed-width clipping or invented support. */
import { z } from 'zod';
import { coverageHash } from './cassian-claim-reconciliation';
import { validateSourceV3, type SourceV3 } from './cassian-evidence-v3';
import { excerptSource, packetWriterInput, type PreparedPacket } from './cassian-source-packets';
import { locateQuote } from './cassian-quote-locator';

const id = z.string().regex(/^[a-z0-9-]+$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = z
  .string()
  .min(1)
  .refine((s) => !!s.trim());
const parentEvidence = z
  .object({
    parentId: id,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: text,
  })
  .strict();
const origin = z
  .object({
    sourceId: id,
    parentId: id,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict();
export const completenessPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    packetSha: sha,
    revisionOfPacketSha: sha.nullable(),
    reviewer: z
      .object({ name: text, independence: z.enum(['same-author', 'independent']) })
      .strict(),
    parents: z.array(z.object({ id, readableSha: sha }).strict()),
    sources: z.array(origin),
    facts: z.array(
      z
        .object({
          factId: id,
          assertionSha: sha,
          complete: z.boolean(),
          reason: text,
          components: z
            .array(
              z
                .object({
                  id,
                  assertion: text,
                  kind: z.enum(['relationship', 'qualifier']),
                  status: z.enum(['supported', 'contradicted', 'unknown']),
                  basis: z.enum([
                    'direct_relationship',
                    'recommendation',
                    'subject_mention',
                    'none',
                  ]),
                  evidence: z.array(parentEvidence),
                  reason: text,
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    ),
  })
  .strict();
export type CompletenessPlan = z.infer<typeof completenessPlanSchema>;
type RequiredEvidence = CompletenessPlan['facts'][number]['components'][number]['evidence'][number];
/** Preparation chooses actual identifying words; code computes positions and requires unique context. */
export function locateRequiredEvidence(parent: SourceV3, quote: string): RequiredEvidence {
  validateSourceV3(parent);
  const located = locateQuote(parent.readableText, quote);
  if (located.status !== 'unique')
    throw Error('Required parent evidence needs unique identifying context');
  return { parentId: parent.id, start: located.start, end: located.end, quote: located.quote };
}
export type CompletenessFinding = {
  category: string;
  factId?: string;
  componentId?: string;
  evidence?: number;
};
const eligible = (packet: PreparedPacket) =>
  packet.scope === 'accepted'
    ? packet.facts.filter((f) => f.support === 'reviewed' && f.novelty === 'clear')
    : [];

/** Hashes and exact parent ranges bind the audit. Semantic completeness/directness remain attestations. */
function boundPlan(packet: PreparedPacket, parents: SourceV3[], raw: unknown) {
  packetWriterInput(packet);
  parents.forEach(validateSourceV3);
  const plan = completenessPlanSchema.parse(raw),
    facts = eligible(packet);
  if (
    plan.packetSha !== coverageHash(packet) ||
    new Set(parents.map((p) => p.id)).size !== parents.length ||
    new Set(plan.parents.map((p) => p.id)).size !== parents.length ||
    plan.parents.length !== parents.length ||
    plan.parents.some(
      (p) => !parents.some((s) => s.id === p.id && s.readableSha === p.readableSha),
    ) ||
    new Set(plan.sources.map((s) => s.sourceId)).size !== packet.sources.length ||
    plan.sources.length !== packet.sources.length ||
    new Set(plan.facts.map((f) => f.factId)).size !== facts.length ||
    plan.facts.length !== facts.length ||
    plan.facts.some(
      (f) => !facts.some((a) => a.id === f.factId && coverageHash(a.assertion) === f.assertionSha),
    )
  ) {
    throw Error('Stale or incomplete source plan');
  }
  for (const s of plan.sources) {
    const source = packet.sources.find((p) => p.id === s.sourceId),
      parent = parents.find((p) => p.id === s.parentId);
    if (
      !source ||
      !parent ||
      JSON.stringify(excerptSource(parent, { start: s.start, end: s.end }, s.sourceId).source) !==
        JSON.stringify(source)
    ) {
      throw Error('Source excerpt provenance changed');
    }
  }
  for (const fact of plan.facts) {
    if (
      new Set(fact.components.map((c) => c.id)).size !== fact.components.length ||
      !fact.components.some((c) => c.kind === 'relationship')
    )
      throw Error('Missing relationship or duplicate component ID');
    for (const component of fact.components)
      for (const e of component.evidence) {
        const parent = parents.find((p) => p.id === e.parentId);
        if (
          !parent ||
          e.end <= e.start ||
          e.end > parent.readableText.length ||
          parent.readableText.slice(e.start, e.end) !== e.quote
        ) {
          throw Error('Required parent quotation changed');
        }
      }
  }
  return plan;
}

function locateSupplied(packet: PreparedPacket, plan: CompletenessPlan, e: RequiredEvidence) {
  return plan.sources.flatMap((o) => {
    if (o.parentId !== e.parentId || o.start > e.start || o.end < e.end) return [];
    const source = packet.sources.find((s) => s.id === o.sourceId)!;
    const location = locateQuote(source.readableText, e.quote);
    return location.status === 'unique'
      ? [{ sourceId: source.id, start: location.start, end: location.end, quote: location.quote }]
      : [];
  });
}

export function assessPacketCompleteness(
  packet: PreparedPacket,
  parents: SourceV3[],
  raw: unknown,
) {
  let plan: CompletenessPlan;
  try {
    plan = boundPlan(packet, parents, raw);
  } catch {
    return {
      ready: false as const,
      protocolValid: false as const,
      findings: [{ category: 'invalid_source_plan' }] as CompletenessFinding[],
      plan: null,
      notServingApproval: true as const,
    };
  }
  const findings: CompletenessFinding[] = [];
  if (!eligible(packet).length) findings.push({ category: 'preparation_shortage' });
  for (const fact of plan.facts) {
    const supplied = packet.facts.find((f) => f.id === fact.factId)!;
    if (!fact.complete)
      findings.push({ category: 'incomplete_fact_decomposition', factId: fact.factId });
    for (const component of fact.components) {
      const binding = { factId: fact.factId, componentId: component.id };
      if (component.status === 'contradicted')
        findings.push({ category: 'contradicted_prepared_fact', ...binding });
      if (component.status === 'unknown' || !component.evidence.length)
        findings.push({ category: 'missing_evidence', ...binding });
      if (component.status === 'supported' && component.basis !== 'direct_relationship') {
        findings.push({ category: 'indirect_support', ...binding });
      }
      for (const [evidence, e] of component.evidence.entries()) {
        const matches = locateSupplied(packet, plan, e);
        if (!matches.length)
          findings.push({ category: 'missing_packet_evidence', ...binding, evidence });
        else if (
          !matches.some((m) =>
            supplied.evidence.some(
              (s) => s.sourceId === m.sourceId && s.start <= m.start && s.end >= m.end,
            ),
          )
        ) {
          findings.push({ category: 'missing_fact_evidence_binding', ...binding, evidence });
        }
      }
    }
  }
  return {
    ready: findings.length === 0,
    protocolValid: true as const,
    findings,
    plan,
    semanticReview: plan.reviewer.independence,
    sourceTruthReview: 'unassessed' as const,
    notServingApproval: true as const,
  };
}

/** Create a separate revision, adding required contiguous passages; original objects/labels are immutable. */
export function completePacketEvidence(packet: PreparedPacket, parents: SourceV3[], raw: unknown) {
  const plan = boundPlan(packet, parents, raw);
  if (
    !eligible(packet).length ||
    plan.facts.some(
      (f) =>
        !f.complete ||
        f.components.some(
          (c) =>
            c.status !== 'supported' || c.basis !== 'direct_relationship' || !c.evidence.length,
        ),
    )
  ) {
    throw Error('Cannot manufacture complete evidence for unresolved assertions');
  }
  const revised = structuredClone(packet),
    next = structuredClone(plan);
  for (const fact of next.facts)
    for (const component of fact.components)
      for (const e of component.evidence) {
        let matches = locateSupplied(revised, next, e);
        if (!matches.length) {
          const parent = parents.find((p) => p.id === e.parentId)!;
          const sourceId = `coverage-${coverageHash(e).slice(0, 20)}`;
          if (revised.sources.some((s) => s.id === sourceId))
            throw Error('Conflicting coverage source ID');
          const excerpt = excerptSource(parent, { start: e.start, end: e.end }, sourceId);
          revised.sources.push(excerpt.source);
          next.sources.push({ sourceId, parentId: e.parentId, start: e.start, end: e.end });
          matches = locateSupplied(revised, next, e);
        }
        if (!matches.length) throw Error('Required source passage cannot be located');
        const chosen = matches[0],
          supplied = revised.facts.find((f) => f.id === fact.factId)!;
        if (
          !supplied.evidence.some(
            (s) => s.sourceId === chosen.sourceId && s.start <= chosen.start && s.end >= chosen.end,
          )
        )
          supplied.evidence.push(chosen);
      }
  next.packetSha = coverageHash(revised);
  if (next.packetSha !== coverageHash(packet)) next.revisionOfPacketSha = coverageHash(packet);
  const assessed = assessPacketCompleteness(revised, parents, next);
  if (!assessed.ready) throw Error('Revised packet still lacks required evidence');
  return { packet: revised, plan: next, assessment: assessed };
}

/** Fail before producing writer input. Parent captures and private audit identities never leave this function. */
export function checkedPacketWriterInput(
  packet: PreparedPacket,
  parents: SourceV3[],
  raw: unknown,
) {
  const assessed = assessPacketCompleteness(packet, parents, raw);
  if (!assessed.ready || !assessed.plan)
    throw Error('Source completeness unresolved; writer input withheld');
  const input = JSON.parse(packetWriterInput(packet));
  input.eligibleFacts = input.eligibleFacts.map((f: { id: string }) => ({
    ...f,
    requiredComponents: assessed
      .plan!.facts.find((p) => p.factId === f.id)!
      .components.map((c) => ({
        id: c.id,
        assertion: c.assertion,
        kind: c.kind,
        evidence: c.evidence.flatMap((e) => locateSupplied(packet, assessed.plan!, e).slice(0, 1)),
      })),
  }));
  return JSON.stringify(input);
}
