/** Free, explicit scope adjudication. It does not edit or release executed model scores. */
import { z } from 'zod';
import { coverageHash } from './cassian-claim-reconciliation';
import { assessWriterV4, cardV4Schema, type CardV4, type FieldV4 } from './cassian-evidence-v4';
import { assessCoverageSource } from './cassian-coverage-protocol';
import { locateQuote } from './cassian-quote-locator';
import { hash } from './cassian-fresh-dispatch-core';
import type { PreparedPacket } from './cassian-source-packets';
import { qualityInputV4, type QualityInputV4 } from './cassian-quality-v4';

const text = z
  .string()
  .min(1)
  .refine((s) => !!s.trim());
const field = z.enum(['question', 'answer', 'explanation', 'variant:0', 'variant:1']);
const reviewer = z
  .object({ name: text, independence: z.enum(['same-author', 'independent']) })
  .strict();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const scopeAuditSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogSha: sha,
    reviewer,
    components: z
      .array(
        z
          .object({
            id: text,
            field,
            cardQuote: text,
            assertion: text,
            role: z.enum(['stated', 'answer_identity', 'source_context']),
            reviewIds: z.array(text).min(1),
            reason: text,
          })
          .strict(),
      )
      .min(1),
    mappings: z.array(
      z
        .object({
          componentId: text,
          status: z.enum(['covered', 'missing', 'uncertain']),
          writerIds: z.array(text),
          questionContextIds: z.array(text),
          reason: text,
        })
        .strict(),
    ),
  })
  .strict();
export type ScopeAudit = z.infer<typeof scopeAuditSchema>;

function fieldText(card: CardV4, key: FieldV4) {
  return key.startsWith('variant:')
    ? card.variants[Number(key.slice(8))]
    : card[key as 'question' | 'answer' | 'explanation'];
}
const sameSet = (a: string[], b: string[]) =>
  new Set(a).size === a.length && a.length === b.length && a.every((x) => b.includes(x));

/** Catalog all original reconstructed assertions. Context removals need explicit bound attestations. */
export function cardScopeCatalog(
  card: CardV4,
  packet: PreparedPacket,
  raw: string,
  stop: string | null,
) {
  cardV4Schema.parse(card);
  if (card.claims.length) {
    const writer = assessWriterV4(
      JSON.stringify({ status: 'candidate', reason: '', card }),
      'end_turn',
      packet,
      card.id,
      'strict',
    );
    if (writer.status !== 'candidate' || writer.issues.length)
      throw Error('Invalid original writer inventory');
  }
  const source = assessCoverageSource(raw, stop, card, packet.sources);
  if (!source.protocolValid || !source.assessment)
    throw Error('Invalid original source reconstruction');
  const body = {
    cardSha: coverageHash(card),
    packetSha: coverageHash(packet),
    rawSha: hash(raw),
    card,
    sourceDecision: source.decision,
    writers: card.claims.map((c, i) => ({
      id: `writer-${i}-${coverageHash(c).slice(0, 16)}`,
      ...c,
    })),
    reviewers: source.assessment.fields.flatMap((f) =>
      f.claims.map((c, i) => ({
        id: `review-${f.field.replace(':', '-')}-${i}-${coverageHash(c).slice(0, 16)}`,
        field: f.field,
        ...c,
      })),
    ),
  };
  return { ...body, sha: coverageHash(body) };
}
export type CardScopeCatalog = ReturnType<typeof cardScopeCatalog>;

/** Uniform answer references use the whole explicit ask; explanations never inherit inventory records. */
export function reconcileCardScope(catalog: CardScopeCatalog, rawAudit: unknown) {
  const { sha: identity, ...body } = catalog;
  if (coverageHash(body) !== identity) throw Error('Scope catalog changed');
  const audit = scopeAuditSchema.parse(rawAudit);
  if (audit.catalogSha !== identity) throw Error('Stale scope audit');
  const components = audit.components;
  if (new Set(components.map((c) => c.id)).size !== components.length)
    throw Error('Duplicate component');
  for (const c of components) {
    const value = fieldText(catalog.card, c.field);
    if (value === undefined || locateQuote(value, c.cardQuote).status !== 'unique')
      throw Error('Unbound component quote');
    if (
      new Set(c.reviewIds).size !== c.reviewIds.length ||
      c.reviewIds.some((id) => !catalog.reviewers.some((r) => r.id === id && r.field === c.field))
    )
      throw Error('Cross-field or unknown reconstruction');
    if (c.role === 'answer_identity' && c.field !== 'answer' && !c.field.startsWith('variant:'))
      throw Error('Answer reference outside answer/variant');
    if ((c.field === 'answer' || c.field.startsWith('variant:')) && c.role === 'source_context')
      throw Error('Cannot discard an answer as source context');
  }
  if (catalog.reviewers.some((r) => !components.some((c) => c.reviewIds.includes(r.id))))
    throw Error('Omitted reconstructed assertion');
  // A mixed reconstructed claim can be split, but its actual field must retain a material target.
  for (const key of new Set(catalog.reviewers.map((r) => r.field))) {
    if (!components.some((c) => c.field === key && c.role !== 'source_context'))
      throw Error('Entire asserted field discarded');
  }
  const material = components.filter((c) => c.role !== 'source_context');
  if (
    !sameSet(
      audit.mappings.map((m) => m.componentId),
      material.map((c) => c.id),
    )
  )
    throw Error('Incomplete or duplicate scope mapping');
  const question = material.filter((c) => c.field === 'question').map((c) => c.id);
  for (const m of audit.mappings) {
    const c = material.find((c) => c.id === m.componentId)!;
    if (
      new Set(m.writerIds).size !== m.writerIds.length ||
      m.writerIds.some((id) => !catalog.writers.some((w) => w.id === id && w.field === c.field)) ||
      (m.status === 'covered' && !m.writerIds.length) ||
      (m.status === 'missing' && m.writerIds.length)
    )
      throw Error('Invalid same-field writer mapping');
    // Even a missing identity must carry the full ask binding, preventing selective context waivers.
    if (
      c.role === 'answer_identity'
        ? !sameSet(m.questionContextIds, question)
        : m.questionContextIds.length
    )
      throw Error('Invalid inherited question context');
  }
  const questionComplete = question.every(
    (id) => audit.mappings.find((m) => m.componentId === id)!.status === 'covered',
  );
  const rows = audit.mappings.map((m) => {
    const c = material.find((c) => c.id === m.componentId)!;
    const contextBlocked = c.role === 'answer_identity' && !questionComplete;
    return {
      ...m,
      field: c.field,
      role: c.role,
      contextBlocked,
      resolved: m.status === 'covered' && !contextBlocked,
    };
  });
  return {
    catalogSha: identity,
    auditSha: coverageHash(audit),
    rows,
    complete: rows.every((r) => r.resolved),
    questionComplete,
    contextOnly: components.filter((c) => c.role === 'source_context'),
    originalSourceDecision: catalog.sourceDecision,
    semanticReview: audit.reviewer,
    notServingApproval: true as const,
  };
}

/** Explicit role extraction is adjudicator work. Matching typed roles is not automatic text entailment. */
export const relationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('formation'),
      participants: z
        .array(text)
        .min(2)
        .refine((a) => new Set(a).size === a.length),
      result: text,
      resultState: z.enum(['new', 'existing', 'unspecified']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('accession'),
      entrant: text,
      target: text,
      targetState: z.enum(['existing', 'unspecified']),
    })
    .strict(),
  z.object({ kind: z.literal('chronology'), earlier: text, later: text }).strict(),
  z.object({ kind: z.literal('attribution'), speaker: text, utterance: text }).strict(),
  z.object({ kind: z.literal('mention'), entities: z.array(text).min(1) }).strict(),
]);
export type ScopedRelation = z.infer<typeof relationSchema>;
export function compareScopedRelation(rawCard: unknown, rawSource: unknown) {
  const card = relationSchema.parse(rawCard),
    source = relationSchema.parse(rawSource);
  if (card.kind === 'mention' || source.kind === 'mention') return 'unknown' as const;
  if (card.kind === 'formation' && source.kind === 'formation') {
    if (!sameSet(card.participants, source.participants) || card.result !== source.result)
      return 'unknown' as const;
    if (card.resultState === 'unspecified' || source.resultState === 'unspecified')
      return 'unknown' as const;
    return card.resultState === source.resultState
      ? ('supported' as const)
      : ('contradicted' as const);
  }
  if (card.kind === 'accession' && source.kind === 'formation') {
    if (!source.participants.includes(card.entrant) || card.target !== source.result)
      return 'unknown' as const;
    return card.targetState === 'existing' && source.resultState === 'new'
      ? ('contradicted' as const)
      : ('unknown' as const);
  }
  if (card.kind === 'accession' && source.kind === 'accession') {
    if (
      card.entrant !== source.entrant ||
      card.target !== source.target ||
      card.targetState === 'unspecified' ||
      source.targetState === 'unspecified'
    )
      return 'unknown' as const;
    return 'supported' as const;
  }
  if (card.kind === 'chronology' && source.kind === 'chronology') {
    if (card.earlier === source.earlier && card.later === source.later) return 'supported' as const;
    if (card.earlier === source.later && card.later === source.earlier)
      return 'contradicted' as const;
  }
  if (
    card.kind === 'attribution' &&
    source.kind === 'attribution' &&
    card.utterance === source.utterance
  )
    return card.speaker === source.speaker ? ('supported' as const) : ('contradicted' as const);
  return 'unknown' as const;
}

/** Obscurity alone cannot supply two competing interpretations of an unchanged ask. */
export const ambiguityWitnessSchema = z
  .object({
    schemaVersion: z.literal(1),
    inputSha: sha,
    reviewer,
    alternatives: z
      .array(
        z
          .object({
            answer: text,
            referentId: text,
            interpretation: text,
            fitsUnchangedAsk: z.literal(true),
            questionQuote: text,
            reason: text,
          })
          .strict(),
      )
      .length(2),
  })
  .strict();
export function assessAmbiguityWitness(input: QualityInputV4, raw: unknown) {
  qualityInputV4([input]);
  const parsed = ambiguityWitnessSchema.safeParse(raw);
  const invalid = () => ({
    status: 'insufficient_witness' as const,
    notServingApproval: true as const,
  });
  if (!parsed.success) return invalid();
  const w = parsed.data;
  if (
    w.inputSha !== coverageHash(input) ||
    w.alternatives[0].referentId === w.alternatives[1].referentId ||
    w.alternatives[0].answer === w.alternatives[1].answer ||
    w.alternatives.some((a) => locateQuote(input.question, a.questionQuote).status !== 'unique')
  )
    return invalid();
  return {
    status: 'explicit_ambiguity_attestation' as const,
    reviewer: w.reviewer,
    witnessSha: coverageHash(w),
    notServingApproval: true as const,
  };
}

export const CARD_SCOPE_POLICY = `Version 1, offline proposed policy. A material question assertion comes from the actual words of the question: stated relationships and qualifiers, plus the minimal entity/trial/work identity needed to interpret them. A name does not assert every source detail about that entity. Decompose mixed reconstructed claims into card-stated components and explicitly identified source context; never silently delete them. Scope decomposition and equivalence are semantic attestations bound to complete original inputs, not consequences of overlapping quotes.
An answer or variant used as a name/term/number refers to the answer variable of the same complete ask. Each needs a local same-field identity record and the identical explicit binding to ALL material question components. Those question inventory components must themselves be covered. Additional factual content stated in an answer requires its own same-field record. Explanations record their own assertions and never inherit question/answer inventory. Sources and acceptance must still verify each canonical answer and variant against the complete ask. Scope reconciliation never erases original source or quality failures.
Specialist knowledge is a difficulty consideration, not ambiguity by itself. Ambiguity needs two distinct referents/interpretations that fit the unchanged ask; spelling variants of one entity do not count. An explicit witness is still an adjudicator assertion, not proven truth. Named studies and precise outcome clues can be appropriate at specialist tier. Missing a witness leaves the ambiguity reason unsubstantiated; it does not establish a quality pass.
Preserve entity-formation participants/result/newness, attribution and chronology. Author-normalized relation roles can be compared mechanically only after semantic extraction; uncertain roles remain unknown. Historical continuity conventions do not prove that a newly formed result already existed. This policy is not connected to paid dispatch or production and does not rescore earlier studies.`;
