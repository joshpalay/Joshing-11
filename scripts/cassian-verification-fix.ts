/** Offline shadow verification. Trusted bindings are explicit reviewed data, not model verdicts. */
import { z } from 'zod';
import { coverageHash } from './cassian-claim-reconciliation';
import { relationSchema, type CardScopeCatalog, type ScopedRelation } from './cassian-card-scope';
import { modelScopeSchema } from './cassian-scope-protocol';
import { fieldTextV4, type CardV4, type FieldV4 } from './cassian-evidence-v4';
import { quoteKey, validateSourceV3, type SourceV3 } from './cassian-evidence-v3';
import type { PreparedPacket } from './cassian-source-packets';
import { locateQuote } from './cassian-quote-locator';
const text = z
    .string()
    .min(1)
    .refine((s) => !!s.trim()),
  sha = z.string().regex(/^[a-f0-9]{64}$/);
const witness = z.object({ documentId: text, quote: text }).strict();
export const verificationContractSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotSha: sha,
    reviewer: z
      .object({ name: text, independence: z.enum(['same-author', 'independent']) })
      .strict(),
    references: z.array(
      z
        .object({
          id: text,
          kind: z.enum(['entity', 'utterance', 'event', 'variable']),
          labels: z.array(text).min(1),
          witnesses: z.array(witness).min(1),
          reason: text,
        })
        .strict(),
    ),
    requirements: z.array(
      z
        .object({
          id: text,
          field: z.enum(['question', 'answer', 'explanation', 'variant:0', 'variant:1']),
          cardQuote: text,
          writerForms: z.array(text).min(1),
          reason: text,
        })
        .strict(),
    ),
    relations: z.array(
      z
        .object({
          id: text,
          field: z.enum(['question', 'answer', 'explanation', 'variant:0', 'variant:1']),
          cardQuote: text,
          cardRelation: relationSchema,
          sourceRelation: relationSchema,
          evidence: z.array(witness).min(1),
          reason: text,
        })
        .strict(),
    ),
  })
  .strict();
export type VerificationContract = z.infer<typeof verificationContractSchema>;
export function verificationSnapshot(card: CardV4, sources: SourceV3[]) {
  for (const source of sources) validateSourceV3(source);
  const documents = [
    ...(
      [
        'question',
        'answer',
        'explanation',
        ...card.variants.map((_, i) => 'variant:' + i),
      ] as FieldV4[]
    ).map((field) => ({ id: 'card/' + field, text: fieldTextV4(card, field) })),
    ...card.claims.map((c, i) => ({ id: `writer/${i}`, text: c.assertion })),
    ...sources.map((s) => ({ id: 'source/' + s.id, text: s.readableText })),
  ];
  if (new Set(documents.map((d) => d.id)).size !== documents.length)
    throw Error('Duplicate verification document');
  const body = { cardSha: coverageHash(card), sourcesSha: coverageHash(sources), documents };
  return { ...body, sha: coverageHash(body) };
}
export type VerificationSnapshot = ReturnType<typeof verificationSnapshot>;
const key = (s: string) => quoteKey(s).toLocaleLowerCase('und');
function validate(snapshot: VerificationSnapshot, raw: unknown) {
  const { sha: identity, ...body } = snapshot;
  if (coverageHash(body) !== identity) throw Error('Verification snapshot changed');
  const c = verificationContractSchema.parse(raw);
  if (c.snapshotSha !== identity) throw Error('Stale verification contract');
  for (const rows of [c.references, c.requirements, c.relations])
    if (new Set(rows.map((r) => r.id)).size !== rows.length) throw Error('Duplicate contract ID');
  const check = (w: z.infer<typeof witness>) => {
    const doc = snapshot.documents.find((d) => d.id === w.documentId);
    if (!doc || locateQuote(doc.text, w.quote).status !== 'unique')
      throw Error('Unbound contract witness');
  };
  for (const r of c.references) for (const w of r.witnesses) check(w);
  for (const r of c.requirements) check({ documentId: 'card/' + r.field, quote: r.cardQuote });
  for (const r of c.relations) {
    check({ documentId: 'card/' + r.field, quote: r.cardQuote });
    for (const w of r.evidence) {
      if (!w.documentId.startsWith('source/')) throw Error('Relation evidence must be a source');
      check(w);
    }
  }
  return c;
}
function reference(c: VerificationContract, label: string, kind: 'entity' | 'utterance' | 'event') {
  const found = c.references.filter((r) => r.labels.some((v) => key(v) === key(label)));
  // Unknown, ambiguous, variables and non-speech events never become contradictory people.
  return found.length === 1 && found[0].kind === kind ? found[0].id : null;
}
function bound(c: VerificationContract, r: ScopedRelation): ScopedRelation | null {
  const get = (label: string, k: 'entity' | 'utterance' | 'event') => reference(c, label, k);
  if (r.kind === 'mention') return r;
  if (r.kind === 'attribution') {
    const speaker = get(r.speaker, 'entity'),
      utterance = get(r.utterance, 'utterance');
    return speaker && utterance ? { ...r, speaker, utterance } : null;
  }
  if (r.kind === 'chronology') {
    const earlier = get(r.earlier, 'event'),
      later = get(r.later, 'event');
    return earlier && later ? { ...r, earlier, later } : null;
  }
  if (r.kind === 'accession') {
    const entrant = get(r.entrant, 'entity'),
      target = get(r.target, 'entity');
    return entrant && target ? { ...r, entrant, target } : null;
  }
  const participants = r.participants.map((p) => get(p, 'entity')),
    result = get(r.result, 'entity');
  return participants.every((p) => p) && result
    ? { ...r, participants: participants as string[], result }
    : null;
}
function sameRelation(a: ScopedRelation, b: ScopedRelation) {
  const normalize = (r: ScopedRelation) =>
    r.kind === 'formation' ? { ...r, participants: [...r.participants].sort() } : r;
  return coverageHash(normalize(a)) === coverageHash(normalize(b));
}
export function compareVerifiedRelation(
  snapshot: VerificationSnapshot,
  rawContract: unknown,
  targetId: string,
  rawCard: unknown,
  rawSource: unknown,
) {
  const c = validate(snapshot, rawContract),
    target = c.relations.find((r) => r.id === targetId);
  if (!target) throw Error('Unknown declared relation target');
  const unknown = (issue: string) => ({
    status: 'unknown' as const,
    issue,
    targetId,
    notServingApproval: true as const,
  });
  const parsedCard = relationSchema.parse(rawCard),
    parsedSource = relationSchema.parse(rawSource);
  if (parsedCard.kind !== target.cardRelation.kind) return unknown('card_relation_changed');
  if (parsedSource.kind !== target.sourceRelation.kind)
    return unknown('source_relation_unverified');
  const card = bound(c, parsedCard),
    source = bound(c, parsedSource),
    expectedCard = bound(c, target.cardRelation),
    expectedSource = bound(c, target.sourceRelation);
  if (!card || !source || !expectedCard || !expectedSource) return unknown('unresolved_reference');
  if (!sameRelation(card, expectedCard)) return unknown('card_relation_changed');
  if (!sameRelation(source, expectedSource)) return unknown('source_relation_unverified');
  // Input role structures must agree with the source-bound reviewed relation, not just each other.
  if (card.kind === 'mention' || source.kind === 'mention')
    return unknown('relationship_not_established');
  if (
    card.kind === 'attribution' &&
    source.kind === 'attribution' &&
    card.utterance === source.utterance
  )
    return {
      status: card.speaker === source.speaker ? ('supported' as const) : ('contradicted' as const),
      issue: null,
      targetId,
      notServingApproval: true as const,
    };
  if (card.kind === 'chronology' && source.kind === 'chronology') {
    if (card.earlier === source.earlier && card.later === source.later)
      return {
        status: 'supported' as const,
        issue: null,
        targetId,
        notServingApproval: true as const,
      };
    if (card.earlier === source.later && card.later === source.earlier)
      return {
        status: 'contradicted' as const,
        issue: null,
        targetId,
        notServingApproval: true as const,
      };
  }
  if (
    card.kind === 'accession' &&
    source.kind === 'formation' &&
    source.participants.includes(card.entrant) &&
    card.target === source.result &&
    card.targetState === 'existing' &&
    source.resultState === 'new'
  )
    return {
      status: 'contradicted' as const,
      issue: null,
      targetId,
      notServingApproval: true as const,
    };
  if (
    card.kind === 'formation' &&
    source.kind === 'formation' &&
    coverageHash([...card.participants].sort()) === coverageHash([...source.participants].sort()) &&
    card.result === source.result &&
    card.resultState !== 'unspecified' &&
    source.resultState !== 'unspecified'
  )
    return {
      status:
        card.resultState === source.resultState
          ? ('supported' as const)
          : ('contradicted' as const),
      issue: null,
      targetId,
      notServingApproval: true as const,
    };
  return unknown('relationship_not_established');
}
export function verifyRelationProposal(
  snapshot: VerificationSnapshot,
  rawContract: unknown,
  targetId: string,
  proposal: {
    field: FieldV4;
    cardQuote: string;
    cardRelation: unknown;
    evidence: { sourceId: string; quote: string; relation: unknown }[];
  },
) {
  const contract = validate(snapshot, rawContract),
    target = contract.relations.find((r) => r.id === targetId);
  if (!target) throw Error('Unknown declared relation target');
  const cardDoc = snapshot.documents.find((d) => d.id === 'card/' + proposal.field),
    location = cardDoc && locateQuote(cardDoc.text, proposal.cardQuote);
  const invalid = (issue: string) => ({
    status: 'unknown' as const,
    issue,
    targetId,
    notServingApproval: true as const,
  });
  if (
    proposal.field !== target.field ||
    !location ||
    location.status !== 'unique' ||
    key(proposal.cardQuote) !== key(target.cardQuote)
  )
    return invalid('unbound_relation_target');
  if (!proposal.evidence.length) return invalid('missing_relation_evidence');
  const results = proposal.evidence.map((e) => {
    const doc = snapshot.documents.find((d) => d.id === 'source/' + e.sourceId);
    if (!doc || locateQuote(doc.text, e.quote).status !== 'unique')
      return invalid('invalid_source_quote');
    if (!target.evidence.some((w) => w.documentId === doc.id && key(w.quote) === key(e.quote)))
      return invalid('unreviewed_source_span');
    return compareVerifiedRelation(snapshot, contract, targetId, proposal.cardRelation, e.relation);
  });
  // Unknown/invalid evidence cannot be erased by adding an unrelated favorable comparison.
  const unknown = results.find((r) => r.status === 'unknown');
  if (unknown) return unknown;
  return results.find((r) => r.status === 'contradicted') ?? results[0];
}
const wordChar = (s: string) => /[\p{L}\p{N}_]/u.test(s);
function containsForm(value: string, form: string) {
  const hay = key(value),
    needle = key(form);
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const before = hay[at - 1],
      after = hay[at + needle.length];
    if ((!before || !wordChar(before)) && (!after || !wordChar(after))) return true;
  }
  return false;
}
/** Required atoms and local identity witnesses come from the bound contract, never a model waiver. */
export function verifyProtectedScope(
  catalog: CardScopeCatalog,
  packet: PreparedPacket,
  rawContract: unknown,
  rawScope: unknown,
) {
  const { sha: catalogSha, ...catalogBody } = catalog;
  if (coverageHash(catalogBody) !== catalogSha) throw Error('Scope catalog changed');
  if (coverageHash(packet) !== catalog.packetSha) throw Error('Scope packet changed');
  const snapshot = verificationSnapshot(catalog.card, packet.sources),
    contract = validate(snapshot, rawContract),
    scope = modelScopeSchema.parse(rawScope);
  if (scope.catalogSha !== catalog.sha) throw Error('Stale scope proposal');
  const ids = scope.components.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw Error('Duplicate proposed component');
  const material = scope.components.filter((c) => c.role !== 'source_context');
  if (
    scope.mappings.length !== material.length ||
    new Set(scope.mappings.map((m) => m.componentId)).size !== material.length ||
    scope.mappings.some((m) => !material.some((c) => c.id === m.componentId))
  )
    throw Error('Incomplete scope proposal');
  for (const c of scope.components) {
    if (
      locateQuote(fieldTextV4(catalog.card, c.field), c.cardQuote).status !== 'unique' ||
      new Set(c.reviewIds).size !== c.reviewIds.length ||
      !c.reviewIds.length ||
      c.reviewIds.some((id) => !catalog.reviewers.some((r) => r.id === id && r.field === c.field))
    )
      throw Error('Unbound proposed component');
    if (c.role === 'answer_identity' && c.field !== 'answer' && !c.field.startsWith('variant:'))
      throw Error('Invalid identity field');
    if (c.role === 'source_context' && (c.field === 'answer' || c.field.startsWith('variant:')))
      throw Error('Cannot discard answer');
  }
  for (const field of new Set(catalog.reviewers.map((r) => r.field)))
    if (!material.some((c) => c.field === field))
      throw Error('Cannot discard entire asserted field');
  if (catalog.reviewers.some((r) => !scope.components.some((c) => c.reviewIds.includes(r.id))))
    throw Error('Omitted reconstruction');
  for (const m of scope.mappings) {
    const c = material.find((c) => c.id === m.componentId)!;
    if (
      new Set(m.writerIds).size !== m.writerIds.length ||
      m.writerIds.some((id) => !catalog.writers.some((w) => w.id === id && w.field === c.field)) ||
      (m.status === 'covered' && !m.writerIds.length) ||
      (m.status === 'missing' && m.writerIds.length)
    )
      throw Error('Invalid local writer mapping');
    if (c.role !== 'answer_identity' && m.questionContextIds.length)
      throw Error('Explanation/stated component cannot borrow context');
  }
  const requirements = contract.requirements.map((r) => ({
    id: r.id,
    field: r.field,
    covered: catalog.writers.some(
      (w) => w.field === r.field && r.writerForms.some((f) => containsForm(w.assertion, f)),
    ),
    reason: r.reason,
  }));
  const questionComplete =
    scope.mappings
      .filter((m) => material.find((c) => c.id === m.componentId)!.field === 'question')
      .every((m) => m.status === 'covered') &&
    requirements.filter((r) => r.field === 'question').every((r) => r.covered);
  const contextIds = [
    ...material.filter((c) => c.field === 'question').map((c) => c.id),
    ...requirements.filter((r) => r.field === 'question').map((r) => 'required/' + r.id),
  ];
  const identities = (documentId: string) =>
    contract.references
      .filter((r) => r.kind === 'entity' && r.witnesses.some((w) => w.documentId === documentId))
      .map((r) => r.id);
  const rows = scope.mappings.map((m) => {
    const c = material.find((c) => c.id === m.componentId)!;
    if (c.role !== 'answer_identity')
      return {
        ...m,
        field: c.field,
        status: m.status,
        contextIds: [] as string[],
        resolved: m.status === 'covered',
      };
    const cardIds = identities('card/' + c.field),
      matching =
        cardIds.length === 1
          ? catalog.writers.filter(
              (w) =>
                w.field === c.field &&
                identities('writer/' + catalog.writers.indexOf(w)).includes(cardIds[0]),
            )
          : [];
    return {
      ...m,
      field: c.field,
      claimedStatus: m.status,
      status: matching.length
        ? ('covered_by_bound_identity' as const)
        : ('unresolved_identity' as const),
      writerIds: matching.map((w) => w.id),
      contextIds: [...contextIds],
      resolved: matching.length > 0 && questionComplete,
    };
  });
  return {
    catalogSha,
    contractSha: coverageHash(contract),
    requirements,
    rows,
    questionComplete,
    complete: requirements.every((r) => r.covered) && rows.every((r) => r.resolved),
    originalSourceDecision: catalog.sourceDecision,
    semanticReview: contract.reviewer,
    notServingApproval: true as const,
  };
}
