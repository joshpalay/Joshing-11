import { describe, expect, it } from 'vitest';
import { readableSource } from './cassian-evidence-v3';
import { hash } from './cassian-fresh-dispatch-core';
import { cardScopeCatalog } from './cassian-card-scope';
import type { CardV4 } from './cassian-evidence-v4';
import type { PreparedPacket } from './cassian-source-packets';
import {
  verificationSnapshot,
  compareVerifiedRelation,
  verifyRelationProposal,
  verifyProtectedScope,
  type VerificationContract,
} from './cassian-verification-fix';
const makeSource = (line: string) =>
  readableSource({
    id: 's',
    url: 'https://example.com/fixture',
    title: 'Fixture',
    section: 'Body',
    edition: null,
    rawText: line,
    captureSha: hash(line),
    extractionSha: hash(line),
    removed: [],
    locator: 'fixture',
  });
function speech() {
  const source = makeSource('KING: Time passes slowly. LAERTES: Why? A and B formed C.');
  const card: CardV4 = {
    schemaVersion: 4,
    id: 'case',
    question: "Complete the King's line: 'Time passes ___'.",
    answer: 'slowly',
    explanation: 'Laertes speaks Time passes slowly.',
    variants: [],
    claims: [],
    scaffolding: [],
  };
  const snapshot = verificationSnapshot(card, [source]);
  const contract: VerificationContract = {
    schemaVersion: 1,
    snapshotSha: snapshot.sha,
    reviewer: { name: 'Fixture author', independence: 'same-author' },
    requirements: [],
    references: [
      {
        id: 'king',
        kind: 'entity',
        labels: ['the King', 'KING', 'King'],
        witnesses: [
          { documentId: 'card/question', quote: card.question },
          { documentId: 'source/s', quote: 'KING: Time passes slowly.' },
        ],
        reason: 'Same speaker, explicit reviewed identity.',
      },
      {
        id: 'laertes',
        kind: 'entity',
        labels: ['Laertes'],
        witnesses: [
          { documentId: 'card/explanation', quote: card.explanation },
          { documentId: 'source/s', quote: 'LAERTES: Why?' },
        ],
        reason: 'Different speaker.',
      },
      {
        id: 'line',
        kind: 'utterance',
        labels: ['Time passes ___', 'Time passes slowly'],
        witnesses: [
          { documentId: 'card/question', quote: card.question },
          { documentId: 'source/s', quote: 'KING: Time passes slowly.' },
        ],
        reason: 'Reviewed blank and completed utterance identity.',
      },
      {
        id: 'variable',
        kind: 'variable',
        labels: ['which player'],
        witnesses: [{ documentId: 'card/question', quote: card.question }],
        reason: 'An unbound answer variable, not another entity.',
      },
      {
        id: 'score',
        kind: 'event',
        labels: ['first basket'],
        witnesses: [{ documentId: 'source/s', quote: 'A and B formed C.' }],
        reason: 'Synthetic nonspeech event label; never an utterance.',
      },
    ],
    relations: [
      {
        id: 'q',
        field: 'question',
        cardQuote: card.question,
        cardRelation: { kind: 'attribution', speaker: 'the King', utterance: 'Time passes ___' },
        sourceRelation: { kind: 'attribution', speaker: 'KING', utterance: 'Time passes slowly' },
        evidence: [{ documentId: 'source/s', quote: 'KING: Time passes slowly.' }],
        reason: 'Correct source-bound question attribution.',
      },
      {
        id: 'e',
        field: 'explanation',
        cardQuote: card.explanation,
        cardRelation: { kind: 'attribution', speaker: 'Laertes', utterance: 'Time passes slowly' },
        sourceRelation: { kind: 'attribution', speaker: 'KING', utterance: 'Time passes slowly' },
        evidence: [{ documentId: 'source/s', quote: 'KING: Time passes slowly.' }],
        reason: 'Incorrect speaker.',
      },
    ],
  };
  return { source, card, snapshot, contract };
}
describe('bound references and reviewed predicate targets', () => {
  it('supports differently spelled speaker and blank/full utterance references', () => {
    const f = speech();
    expect(
      compareVerifiedRelation(
        f.snapshot,
        f.contract,
        'q',
        { kind: 'attribution', speaker: 'King', utterance: 'Time passes ___' },
        { kind: 'attribution', speaker: 'KING', utterance: 'Time passes slowly' },
      ).status,
    ).toBe('supported');
  });
  it('retains a real wrong-speaker contradiction with the same utterance', () => {
    const f = speech();
    expect(
      compareVerifiedRelation(
        f.snapshot,
        f.contract,
        'e',
        f.contract.relations[1].cardRelation,
        f.contract.relations[1].sourceRelation,
      ).status,
    ).toBe('contradicted');
  });
  it('never turns unknown or variable labels into contradictory speakers', () => {
    const f = speech();
    for (const speaker of ['undeclared', 'which player'])
      expect(
        compareVerifiedRelation(
          f.snapshot,
          f.contract,
          'q',
          { kind: 'attribution', speaker, utterance: 'Time passes ___' },
          f.contract.relations[0].sourceRelation,
        ).status,
      ).toBe('unknown');
  });
  it('does not treat a scoring event as spoken dialogue', () => {
    const f = speech();
    expect(
      compareVerifiedRelation(
        f.snapshot,
        f.contract,
        'q',
        { kind: 'attribution', speaker: 'King', utterance: 'first basket' },
        f.contract.relations[0].sourceRelation,
      ).status,
    ).toBe('unknown');
  });
  it('preserves ambiguity when one label is assigned to two entities', () => {
    const f = speech();
    f.contract.references[1].labels.push('King');
    expect(
      compareVerifiedRelation(
        f.snapshot,
        f.contract,
        'q',
        f.contract.relations[0].cardRelation,
        f.contract.relations[0].sourceRelation,
      ).status,
    ).toBe('unknown');
  });
  it('rejects stale documents and invented contract witnesses', () => {
    const f = speech();
    const changed = verificationSnapshot({ ...f.card, answer: 'quickly' }, [f.source]);
    expect(() =>
      compareVerifiedRelation(
        changed,
        f.contract,
        'q',
        f.contract.relations[0].cardRelation,
        f.contract.relations[0].sourceRelation,
      ),
    ).toThrow('Stale');
    f.contract.references[0].witnesses[0].quote = 'invented';
    expect(() =>
      compareVerifiedRelation(
        f.snapshot,
        f.contract,
        'q',
        f.contract.relations[0].cardRelation,
        f.contract.relations[0].sourceRelation,
      ),
    ).toThrow('Unbound');
  });
  it('rejects quote splices in model proposals without repairing them', () => {
    const f = speech();
    expect(
      verifyRelationProposal(f.snapshot, f.contract, 'q', {
        field: 'question',
        cardQuote: f.card.question,
        cardRelation: f.contract.relations[0].cardRelation,
        evidence: [
          {
            sourceId: 's',
            quote: 'KING ... slowly.',
            relation: f.contract.relations[0].sourceRelation,
          },
        ],
      }).issue,
    ).toBe('invalid_source_quote');
  });
  it('rejects another exact source span carrying borrowed reviewed relation roles', () => {
    const f = speech();
    expect(
      verifyRelationProposal(f.snapshot, f.contract, 'q', {
        field: 'question',
        cardQuote: f.card.question,
        cardRelation: f.contract.relations[0].cardRelation,
        evidence: [
          {
            sourceId: 's',
            quote: 'LAERTES: Why?',
            relation: f.contract.relations[0].sourceRelation,
          },
        ],
      }).issue,
    ).toBe('unreviewed_source_span');
  });
  it('does not accept model-invented chronology when source-bound review only establishes a mention', () => {
    const f = speech();
    for (const [id, label] of [
      ['early', 'principles'],
      ['late', 'summary'],
    ])
      f.contract.references.push({
        id,
        kind: 'event',
        labels: [label],
        witnesses: [{ documentId: 'source/s', quote: 'A and B formed C.' }],
        reason: 'Synthetic identified events, no order established.',
      });
    f.contract.relations[0] = {
      ...f.contract.relations[0],
      cardRelation: { kind: 'chronology', earlier: 'principles', later: 'summary' },
      sourceRelation: { kind: 'mention', entities: ['principles', 'summary'] },
    };
    expect(
      compareVerifiedRelation(f.snapshot, f.contract, 'q', f.contract.relations[0].cardRelation, {
        kind: 'chronology',
        earlier: 'principles',
        later: 'summary',
      }),
    ).toMatchObject({ status: 'unknown', issue: 'source_relation_unverified' });
  });
  it('detects formation versus accession and refuses a silently rewritten card predicate', () => {
    const f = speech();
    for (const label of ['A', 'B', 'C'])
      f.contract.references.push({
        id: label,
        kind: 'entity',
        labels: [label],
        witnesses: [{ documentId: 'source/s', quote: 'A and B formed C.' }],
        reason: 'Reviewed formation entity.',
      });
    const card = {
        kind: 'accession' as const,
        entrant: 'A',
        target: 'C',
        targetState: 'existing' as const,
      },
      source = {
        kind: 'formation' as const,
        participants: ['A', 'B'],
        result: 'C',
        resultState: 'new' as const,
      };
    f.contract.relations[0] = {
      ...f.contract.relations[0],
      cardRelation: card,
      sourceRelation: source,
    };
    expect(compareVerifiedRelation(f.snapshot, f.contract, 'q', card, source).status).toBe(
      'contradicted',
    );
    expect(compareVerifiedRelation(f.snapshot, f.contract, 'q', source, source)).toMatchObject({
      status: 'unknown',
      issue: 'card_relation_changed',
    });
  });
});
function scopeFixture() {
  const line =
    'Adjacent tones in a twelve-pitch chromatic scale are separated by a semitone, also called a half step.';
  const source = makeSource(line);
  const card: CardV4 = {
    schemaVersion: 4,
    id: 'scope',
    question: 'In a twelve-pitch chromatic scale, what interval separates adjacent tones?',
    answer: 'Semitone',
    explanation: line,
    variants: ['Half step'],
    scaffolding: [],
    claims: [
      {
        field: 'question',
        cardQuote: 'adjacent tones',
        assertion: 'Adjacent tones in a chromatic scale are separated by an interval.',
        factIds: ['f'],
      },
      {
        field: 'answer',
        cardQuote: 'Semitone',
        assertion: 'Semitone identifies the interval.',
        factIds: ['f'],
      },
      { field: 'explanation', cardQuote: line, assertion: line, factIds: ['f'] },
      {
        field: 'variant:0',
        cardQuote: 'Half step',
        assertion: 'Half step is an equivalent interval name.',
        factIds: ['f'],
      },
    ],
  };
  const packet: PreparedPacket = {
    requestId: 'request',
    domain: 'Music',
    tier: 'accessible',
    scope: 'accepted',
    sources: [source],
    facts: [
      {
        id: 'f',
        assertion: line,
        evidence: [{ sourceId: 's', quote: line, start: 0, end: line.length }],
        support: 'reviewed',
        novelty: 'clear',
        rationale: 'Synthetic',
      },
    ],
    preparer: { role: 'prompt-author', independent: false },
  };
  const raw = JSON.stringify({
    schemaVersion: 4,
    id: card.id,
    fields: (['question', 'answer', 'explanation', 'variant:0'] as const).map((field) => ({
      field,
      complete: true,
      claims: [
        {
          cardQuote: field === 'variant:0' ? card.variants[0] : card[field],
          assertion: line,
          status: 'supported',
          basis: 'direct_relationship',
          evidence: [{ sourceId: 's', quote: line }],
          reason: 'Source',
        },
      ],
      acceptance:
        field === 'answer' || field === 'variant:0'
          ? {
              entity: 'match',
              answerType: 'match',
              language: 'match',
              specificity: 'match',
              reason: 'Term alias',
            }
          : null,
      reason: 'Complete',
    })),
  });
  const catalog = cardScopeCatalog(card, packet, raw, 'end_turn'),
    snapshot = verificationSnapshot(card, [source]);
  const contract: VerificationContract = {
    schemaVersion: 1,
    snapshotSha: snapshot.sha,
    reviewer: { name: 'Fixture author', independence: 'same-author' },
    relations: [],
    references: [
      {
        id: 'interval',
        kind: 'entity',
        labels: ['Semitone', 'Half step'],
        witnesses: [
          { documentId: 'card/answer', quote: 'Semitone' },
          { documentId: 'card/variant:0', quote: 'Half step' },
          { documentId: 'writer/1', quote: 'Semitone' },
          { documentId: 'writer/3', quote: 'Half step' },
        ],
        reason: 'Reviewed equivalent names.',
      },
    ],
    requirements: [
      {
        id: 'scale-size',
        field: 'question',
        cardQuote: 'twelve-pitch',
        writerForms: ['twelve-pitch', 'twelve pitches', '12-pitch', '12 pitches'],
        reason: 'Explicit quantity must be recorded within question.',
      },
    ],
  };
  const components = catalog.reviewers.map((r, i) => ({
    id: 'c' + i,
    field: r.field,
    cardQuote: r.cardQuote,
    assertion: r.assertion,
    role: r.field === 'answer' || r.field.startsWith('variant:') ? 'answer_identity' : 'stated',
    reviewIds: [r.id],
    reason: 'Model proposal',
  }));
  const audit = {
    schemaVersion: 1,
    catalogSha: catalog.sha,
    components,
    mappings: components.map((c, i) => ({
      componentId: c.id,
      status: 'covered',
      writerIds: [catalog.writers[i].id],
      questionContextIds: c.role === 'answer_identity' ? ['c0'] : [],
      reason: 'Claimed coverage',
    })),
  };
  return { card, source, packet, raw, catalog, contract, audit };
}
describe('protected requirements and code-derived ask context', () => {
  it('blocks a model covered verdict when the same-field writer record omits the required quantity', () => {
    const f = scopeFixture(),
      r = verifyProtectedScope(f.catalog, f.packet, f.contract, f.audit);
    expect(r.complete).toBe(false);
    expect(r.requirements[0].covered).toBe(false);
    expect(
      r.rows
        .filter((r) => r.field === 'answer' || r.field.startsWith('variant:'))
        .every((r) => !r.resolved),
    ).toBe(true);
  });
  it('accepts explicitly declared harmless numeric wording, keeping canonical and variant context identical', () => {
    const f = scopeFixture();
    f.card.claims[0].assertion =
      'Adjacent tones in a 12-pitch chromatic scale are separated by an interval.';
    const catalog = cardScopeCatalog(f.card, f.packet, f.raw, 'end_turn');
    f.contract.snapshotSha = verificationSnapshot(f.card, [f.source]).sha;
    f.audit.catalogSha = catalog.sha;
    f.audit.mappings[0].writerIds = [catalog.writers[0].id];
    const r = verifyProtectedScope(catalog, f.packet, f.contract, f.audit);
    expect(r.complete).toBe(true);
    expect(
      r.rows
        .filter((r) => r.field === 'answer' || r.field.startsWith('variant:'))
        .map((r) => r.contextIds),
    ).toEqual([
      ['c0', 'required/scale-size'],
      ['c0', 'required/scale-size'],
    ]);
  });
  it('does not let a date, quantity in another field, or an unrelated number satisfy a missing qualifier', () => {
    const f = scopeFixture();
    f.contract.requirements[0].writerForms = ['12 pitches'];
    f.card.claims[0].assertion =
      'Adjacent tones were studied in 2012; the scale existed for 12 years.';
    const catalog = cardScopeCatalog(f.card, f.packet, f.raw, 'end_turn');
    f.contract.snapshotSha = verificationSnapshot(f.card, [f.source]).sha;
    f.audit.catalogSha = catalog.sha;
    f.audit.mappings[0].writerIds = [catalog.writers[0].id];
    expect(
      verifyProtectedScope(catalog, f.packet, f.contract, f.audit).requirements[0].covered,
    ).toBe(false);
  });
  it('cannot waive a protected premise by calling it source context', () => {
    const f = scopeFixture();
    f.audit.components.push({
      ...f.audit.components[0],
      id: 'extra',
      cardQuote: 'twelve-pitch',
      role: 'source_context',
    });
    expect(verifyProtectedScope(f.catalog, f.packet, f.contract, f.audit).complete).toBe(false);
  });
  it('uses a bound local identity even when the model omits inherited context or demands repeated outcome wording', () => {
    const f = scopeFixture();
    f.contract.requirements = [];
    f.audit.mappings[3] = {
      ...f.audit.mappings[3],
      status: 'missing',
      writerIds: [],
      questionContextIds: [],
    };
    const r = verifyProtectedScope(f.catalog, f.packet, f.contract, f.audit);
    expect(r.complete).toBe(true);
    expect(r.rows[3]).toMatchObject({
      claimedStatus: 'missing',
      status: 'covered_by_bound_identity',
      contextIds: ['c0'],
    });
  });
  it('retains real explanation omissions and forbids cross-field borrowing', () => {
    const f = scopeFixture();
    f.contract.requirements = [];
    f.audit.mappings[2] = { ...f.audit.mappings[2], status: 'missing', writerIds: [] };
    expect(verifyProtectedScope(f.catalog, f.packet, f.contract, f.audit).complete).toBe(false);
    f.audit.mappings[2] = {
      ...f.audit.mappings[2],
      status: 'covered',
      writerIds: [f.catalog.writers[1].id],
    };
    expect(() => verifyProtectedScope(f.catalog, f.packet, f.contract, f.audit)).toThrow(
      'local writer',
    );
  });
  it('retains unknown identities and packet/input binding', () => {
    const f = scopeFixture();
    f.contract.requirements = [];
    f.contract.references = [];
    expect(verifyProtectedScope(f.catalog, f.packet, f.contract, f.audit).complete).toBe(false);
    expect(() =>
      verifyProtectedScope(f.catalog, { ...f.packet, domain: 'Changed' }, f.contract, f.audit),
    ).toThrow('packet changed');
  });
  it('cannot turn complete inventory into source approval', () => {
    const f = scopeFixture();
    const response = JSON.parse(f.raw);
    response.fields[2].claims[0] = {
      ...response.fields[2].claims[0],
      status: 'unknown',
      basis: 'none',
      evidence: [],
      reason: 'Missing factual support',
    };
    const catalog = cardScopeCatalog(f.card, f.packet, JSON.stringify(response), 'end_turn');
    const audit = {
      ...f.audit,
      catalogSha: catalog.sha,
      components: f.audit.components.map((c, i) => ({
        ...c,
        reviewIds: [catalog.reviewers[i].id],
      })),
    };
    f.contract.requirements = [];
    const result = verifyProtectedScope(catalog, f.packet, f.contract, audit);
    expect(result.complete).toBe(true);
    expect(result.originalSourceDecision).not.toBe('pass');
    expect(result.notServingApproval).toBe(true);
  });
});
