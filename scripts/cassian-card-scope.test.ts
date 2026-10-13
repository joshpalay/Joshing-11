import { describe, expect, it } from 'vitest';
import { readableSource } from './cassian-evidence-v3';
import type { CardV4 } from './cassian-evidence-v4';
import type { CoverageSourceReply } from './cassian-coverage-protocol';
import { coverageHash } from './cassian-claim-reconciliation';
import type { PreparedPacket } from './cassian-source-packets';
import { hash } from './cassian-fresh-dispatch-core';
import {
  cardScopeCatalog,
  reconcileCardScope,
  compareScopedRelation,
  assessAmbiguityWitness,
  type ScopeAudit,
} from './cassian-card-scope';

const sourceText = 'Mira Vale designed the lamp in 1842.';
const source = readableSource({
  id: 'source-a',
  url: 'https://example.com/fixture',
  title: 'Fixture',
  section: 'Design',
  edition: null,
  rawText: sourceText,
  captureSha: hash(sourceText),
  extractionSha: hash(sourceText),
  removed: [],
  locator: 'fixture',
});
const packet: PreparedPacket = {
  requestId: 'request-a',
  domain: 'Design history',
  tier: 'moderate',
  scope: 'accepted',
  sources: [source],
  facts: [
    {
      id: 'fact-a',
      assertion: sourceText,
      evidence: [{ sourceId: source.id, start: 0, end: sourceText.length, quote: sourceText }],
      support: 'reviewed',
      novelty: 'clear',
      rationale: 'Synthetic.',
    },
  ],
  preparer: { role: 'prompt-author', independent: false },
};
function fixture() {
  const card: CardV4 = {
    schemaVersion: 4,
    id: 'card-a',
    question: 'Who designed the lamp in 1842?',
    answer: 'Mira Vale',
    explanation: sourceText,
    variants: ['Vale'],
    scaffolding: [],
    claims: [
      {
        field: 'question',
        cardQuote: 'the lamp in 1842',
        assertion: 'The lamp was designed in 1842.',
        factIds: ['fact-a'],
      },
      {
        field: 'answer',
        cardQuote: 'Mira Vale',
        assertion: 'Mira Vale identifies the designer of the lamp.',
        factIds: ['fact-a'],
      },
      { field: 'explanation', cardQuote: sourceText, assertion: sourceText, factIds: ['fact-a'] },
      {
        field: 'variant:0',
        cardQuote: 'Vale',
        assertion: 'Vale identifies Mira Vale, the lamp designer.',
        factIds: ['fact-a'],
      },
    ],
  };
  const review: CoverageSourceReply = {
    schemaVersion: 4,
    id: card.id,
    fields: (['question', 'answer', 'explanation', 'variant:0'] as const).map((field) => ({
      field,
      complete: true,
      reason: 'All material assertions reconstructed.',
      claims: [
        {
          cardQuote: field === 'variant:0' ? 'Vale' : card[field],
          assertion: field === 'question' ? 'The lamp was designed in 1842.' : sourceText,
          status: 'supported',
          basis: 'direct_relationship',
          evidence: [{ sourceId: source.id, quote: sourceText }],
          reason: 'Direct relationship.',
        },
      ],
      acceptance:
        field === 'answer' || field === 'variant:0'
          ? {
              entity: 'match',
              answerType: 'match',
              language: 'match',
              specificity: 'match',
              reason: 'Correct person; ask permits surname.',
            }
          : null,
    })),
  };
  const raw = JSON.stringify(review),
    catalog = cardScopeCatalog(card, packet, raw, 'end_turn');
  const audit: ScopeAudit = {
    schemaVersion: 1,
    catalogSha: catalog.sha,
    reviewer: { name: 'Fixture author', independence: 'same-author' },
    components: catalog.reviewers.map((r, i) => ({
      id: `component-${i}`,
      field: r.field,
      cardQuote: r.cardQuote,
      assertion:
        r.field === 'answer' || r.field === 'variant:0'
          ? 'The supplied name identifies the answer referent.'
          : r.assertion,
      role: r.field === 'answer' || r.field === 'variant:0' ? 'answer_identity' : 'stated',
      reviewIds: [r.id],
      reason: 'Explicit semantic decomposition of complete field and ask.',
    })),
    mappings: [],
  };
  audit.mappings = audit.components.map((c) => ({
    componentId: c.id,
    status: 'covered',
    writerIds: [catalog.writers.find((w) => w.field === c.field)!.id],
    questionContextIds: c.role === 'answer_identity' ? ['component-0'] : [],
    reason:
      'Same-field assertion or identity; both answer forms inherit the identical complete ask.',
  }));
  return { card, review, raw, catalog, audit };
}
describe('explicit card scope and uniform answer references', () => {
  it('allows both canonical and variant identity records to inherit the same complete ask', () => {
    const { catalog, audit } = fixture(),
      result = reconcileCardScope(catalog, audit);
    expect(result.complete).toBe(true);
    expect(
      result.rows.filter((r) => r.role === 'answer_identity').map((r) => r.questionContextIds),
    ).toEqual([['component-0'], ['component-0']]);
    expect(result.notServingApproval).toBe(true);
  });
  it('blocks both answer references when an explicit question qualifier is missing', () => {
    const { catalog, audit } = fixture();
    audit.mappings[0] = { ...audit.mappings[0], status: 'missing', writerIds: [] };
    const result = reconcileCardScope(catalog, audit);
    expect(result.questionComplete).toBe(false);
    expect(
      result.rows
        .filter((r) => r.role === 'answer_identity')
        .every((r) => r.contextBlocked && !r.resolved),
    ).toBe(true);
    expect(result.complete).toBe(false);
  });
  it('rejects selective context binding for either answer form', () => {
    for (const index of [1, 3]) {
      const { catalog, audit } = fixture();
      audit.mappings[index].questionContextIds = [];
      expect(() => reconcileCardScope(catalog, audit)).toThrow('inherited question context');
    }
  });
  it('does not allow question or answer records to cover an explanation', () => {
    const { catalog, audit } = fixture();
    audit.mappings[2].writerIds = [catalog.writers[1].id];
    expect(() => reconcileCardScope(catalog, audit)).toThrow('same-field');
    audit.mappings[2].writerIds = [catalog.writers[2].id];
    audit.mappings[2].questionContextIds = ['component-0'];
    expect(() => reconcileCardScope(catalog, audit)).toThrow('inherited question context');
  });
  it('retains a real missing explanation even with complete question and answer context', () => {
    const { catalog, audit } = fixture();
    audit.mappings[2] = { ...audit.mappings[2], status: 'missing', writerIds: [] };
    const result = reconcileCardScope(catalog, audit);
    expect(result.questionComplete).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.rows[2].status).toBe('missing');
  });
  it('requires a local identity record for every variant', () => {
    const { catalog, audit } = fixture();
    audit.mappings[3].writerIds = [];
    expect(() => reconcileCardScope(catalog, audit)).toThrow('same-field');
    audit.mappings[3].status = 'missing';
    expect(reconcileCardScope(catalog, audit).complete).toBe(false);
  });
  it('splits source-context inflation explicitly without discarding the actual premise', () => {
    const { catalog, audit } = fixture();
    audit.components.push({
      ...audit.components[0],
      id: 'extra-context',
      role: 'source_context',
      assertion: 'The designer was commissioned by a city.',
      reason: 'This extra source detail is not asserted by the actual question.',
    });
    const result = reconcileCardScope(catalog, audit);
    expect(result.complete).toBe(true);
    expect(result.contextOnly).toHaveLength(1);
    audit.components[0].role = 'source_context';
    expect(() => reconcileCardScope(catalog, audit)).toThrow('Entire asserted field discarded');
  });
  it('preserves original unknown source decisions despite a complete inventory audit', () => {
    const f = fixture();
    f.review.fields[2].claims[0].status = 'unknown';
    f.review.fields[2].claims[0].basis = 'none';
    f.review.fields[2].claims[0].evidence = [];
    const catalog = cardScopeCatalog(f.card, packet, JSON.stringify(f.review), 'end_turn');
    const audit = {
      ...f.audit,
      catalogSha: catalog.sha,
      components: f.audit.components.map((c, i) => ({
        ...c,
        reviewIds: [catalog.reviewers[i].id],
      })),
    };
    const result = reconcileCardScope(catalog, audit);
    expect(result.complete).toBe(true);
    expect(result.originalSourceDecision).toBe('review');
    expect(result.notServingApproval).toBe(true);
  });
  it('preserves a factual contradiction despite complete inventory coverage', () => {
    const f = fixture();
    f.review.fields[2].claims[0].status = 'contradicted';
    const catalog = cardScopeCatalog(f.card, packet, JSON.stringify(f.review), 'end_turn');
    const audit = {
      ...f.audit,
      catalogSha: catalog.sha,
      components: f.audit.components.map((c, i) => ({
        ...c,
        reviewIds: [catalog.reviewers[i].id],
      })),
    };
    const result = reconcileCardScope(catalog, audit);
    expect(result.complete).toBe(true);
    expect(result.originalSourceDecision).toBe('hold');
    expect(result.notServingApproval).toBe(true);
  });
  it('rejects stale whole-card, packet and native receipt bindings', () => {
    const f = fixture();
    for (const changed of [
      cardScopeCatalog(
        { ...f.card, scaffolding: [{ cardQuote: 'Who', reason: 'interrogative' }] },
        packet,
        f.raw,
        'end_turn',
      ),
      cardScopeCatalog(f.card, { ...packet, domain: 'Other' }, f.raw, 'end_turn'),
      cardScopeCatalog(f.card, packet, f.raw + '\n', 'end_turn'),
    ])
      expect(() => reconcileCardScope(changed, f.audit)).toThrow('Stale scope audit');
    f.catalog.card.question = 'Changed?';
    expect(() => reconcileCardScope(f.catalog, f.audit)).toThrow('catalog changed');
  });
  it('requires complete, unique component and reconstructed-claim accounting', () => {
    const { catalog, audit } = fixture();
    expect(() =>
      reconcileCardScope(catalog, { ...audit, mappings: audit.mappings.slice(1) }),
    ).toThrow('Incomplete');
    expect(() =>
      reconcileCardScope(catalog, { ...audit, components: audit.components.slice(1) }),
    ).toThrow('Omitted');
    expect(() =>
      reconcileCardScope(catalog, { ...audit, mappings: [...audit.mappings, audit.mappings[0]] }),
    ).toThrow('Incomplete');
    expect(() =>
      reconcileCardScope(catalog, {
        ...audit,
        components: [...audit.components, audit.components[0]],
      }),
    ).toThrow('Duplicate');
  });
  it('rejects absent/ambiguous/cross-field quotes and invented claim IDs', () => {
    for (const patch of [
      { cardQuote: 'invented text' },
      { reviewIds: ['missing'] },
      { reviewIds: [fixture().catalog.reviewers[1].id] },
    ]) {
      const { catalog, audit } = fixture();
      Object.assign(audit.components[0], patch);
      expect(() => reconcileCardScope(catalog, audit)).toThrow();
    }
    const f = fixture();
    f.card.explanation = sourceText + ' ' + sourceText;
    f.card.claims[2].cardQuote = f.card.explanation;
    f.review.fields[2].claims[0].cardQuote = f.card.explanation;
    const catalog = cardScopeCatalog(f.card, packet, JSON.stringify(f.review), 'end_turn');
    const audit = {
      ...f.audit,
      catalogSha: catalog.sha,
      components: f.audit.components.map((c, i) => ({
        ...c,
        reviewIds: [catalog.reviewers[i].id],
      })),
    };
    expect(() => reconcileCardScope(catalog, audit)).toThrow('Unbound component quote');
  });
  it('allows harmless quote-anchor differences without inferring semantic coverage from them', () => {
    const { catalog, audit } = fixture();
    audit.components[0].cardQuote = '1842';
    expect(reconcileCardScope(catalog, audit).complete).toBe(true);
    audit.mappings[0].status = 'uncertain';
    expect(reconcileCardScope(catalog, audit).complete).toBe(false);
  });
  it('rejects malformed/nonfinal source replies and unknown writer fact references', () => {
    const f = fixture();
    expect(() => cardScopeCatalog(f.card, packet, f.raw, 'max_tokens')).toThrow();
    expect(() => cardScopeCatalog(f.card, packet, '{}', 'end_turn')).toThrow();
    f.card.claims[0].factIds = ['unknown-fact'];
    expect(() => cardScopeCatalog(f.card, packet, f.raw, 'end_turn')).toThrow('writer inventory');
  });
});

describe('mandatory relation roles stay distinct', () => {
  const formation = {
    kind: 'formation',
    participants: ['predecessor-a', 'predecessor-b'],
    result: 'successor',
    resultState: 'new',
  };
  it('does not treat forming a new entity as entering a preexisting one', () => {
    expect(
      compareScopedRelation(
        {
          kind: 'accession',
          entrant: 'predecessor-a',
          target: 'successor',
          targetState: 'existing',
        },
        formation,
      ),
    ).toBe('contradicted');
    expect(
      compareScopedRelation(
        { ...formation, participants: ['predecessor-b', 'predecessor-a'] },
        formation,
      ),
    ).toBe('supported');
    expect(compareScopedRelation({ ...formation, resultState: 'existing' }, formation)).toBe(
      'contradicted',
    );
  });
  it('retains unknown when newness or participating roles are not established', () => {
    expect(
      compareScopedRelation(
        {
          kind: 'accession',
          entrant: 'predecessor-a',
          target: 'successor',
          targetState: 'unspecified',
        },
        formation,
      ),
    ).toBe('unknown');
    expect(compareScopedRelation({ ...formation, resultState: 'unspecified' }, formation)).toBe(
      'unknown',
    );
    expect(
      compareScopedRelation({ ...formation, participants: ['other-a', 'other-b'] }, formation),
    ).toBe('unknown');
    expect(() =>
      compareScopedRelation({ ...formation, participants: ['same', 'same'] }, formation),
    ).toThrow();
  });
  it('requires actual order rather than a mention for chronology', () => {
    const order = { kind: 'chronology', earlier: 'principles', later: 'summary' };
    expect(
      compareScopedRelation(order, { kind: 'mention', entities: ['principles', 'summary'] }),
    ).toBe('unknown');
    expect(compareScopedRelation(order, order)).toBe('supported');
    expect(
      compareScopedRelation(order, { ...order, earlier: 'summary', later: 'principles' }),
    ).toBe('contradicted');
  });
  it('compares the speaker of the same utterance rather than nearby names', () => {
    const a = { kind: 'attribution', speaker: 'speaker-a', utterance: 'line-id' };
    expect(compareScopedRelation(a, { ...a, speaker: 'speaker-b' })).toBe('contradicted');
    expect(
      compareScopedRelation(a, { kind: 'mention', entities: ['speaker-a', 'speaker-b'] }),
    ).toBe('unknown');
    expect(compareScopedRelation(a, a)).toBe('supported');
  });
});

describe('ambiguity needs explicit competing interpretations', () => {
  const input = {
    id: 'quality-a',
    question: 'Who created the work titled Aurora?',
    answer: 'Mira Vale',
    domain: 'Design history',
    tier: 'specialist' as const,
  };
  const witness = () => ({
    schemaVersion: 1,
    inputSha: coverageHash(input),
    reviewer: { name: 'Fixture author', independence: 'same-author' },
    alternatives: [
      {
        answer: 'Mira Vale',
        referentId: 'artist-a',
        interpretation: 'The sculpture of that title.',
        fitsUnchangedAsk: true,
        questionQuote: 'the work titled Aurora',
        reason: 'Work medium is unspecified.',
      },
      {
        answer: 'Ren Taro',
        referentId: 'artist-b',
        interpretation: 'The painting of that title.',
        fitsUnchangedAsk: true,
        questionQuote: 'the work titled Aurora',
        reason: 'Work medium is unspecified.',
      },
    ],
  });
  it('accepts a bound explicit attestation without treating it as truth or a release', () => {
    expect(assessAmbiguityWitness(input, witness())).toMatchObject({
      status: 'explicit_ambiguity_attestation',
      notServingApproval: true,
    });
  });
  it('does not count spelling variants of one referent as competing answers', () => {
    const w = witness();
    w.alternatives[1].referentId = 'artist-a';
    expect(assessAmbiguityWitness(input, w).status).toBe('insufficient_witness');
  });
  it('does not treat specialist obscurity, a fabricated quote or a changed tier as a witness', () => {
    expect(assessAmbiguityWitness(input, { reason: 'Requires insider knowledge.' }).status).toBe(
      'insufficient_witness',
    );
    const w = witness();
    w.alternatives[1].questionQuote = 'painting';
    expect(assessAmbiguityWitness(input, w).status).toBe('insufficient_witness');
    expect(assessAmbiguityWitness({ ...input, tier: 'accessible' }, witness()).status).toBe(
      'insufficient_witness',
    );
  });
  it('retains unresolved alternatives that do not fit the unchanged ask', () => {
    const w = witness();
    expect(
      assessAmbiguityWitness(input, {
        ...w,
        alternatives: [{ ...w.alternatives[0], fitsUnchangedAsk: false }, w.alternatives[1]],
      }).status,
    ).toBe('insufficient_witness');
  });
});
