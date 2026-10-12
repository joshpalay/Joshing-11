import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readableSource } from './cassian-evidence-v3';
import {
  assessEvidenceV4,
  reconstructionInputV4,
  type CardV4,
  type ReviewV4,
} from './cassian-evidence-v4';
import {
  assessCoverageRepair,
  inventoryCatalog,
  inventoryReconciliationInput,
  reconcileInventory,
  type InventoryAudit,
} from './cassian-claim-reconciliation';
import type { PreparedPacket } from './cassian-source-packets';

const text = 'Mira Vale designed the lamp in 1842.';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const source = readableSource({
  id: 'source-a',
  url: 'https://example.com/history',
  title: 'Fixture',
  section: 'History',
  edition: null,
  rawText: text,
  captureSha: sha(text),
  extractionSha: sha(text),
  removed: [],
  locator: 'fixture',
});
const packet: PreparedPacket = {
  requestId: 'request-a',
  domain: 'Inventors',
  tier: 'moderate',
  scope: 'accepted',
  sources: [source],
  facts: [
    {
      id: 'fact-a',
      assertion: text,
      evidence: [{ sourceId: source.id, start: 0, end: text.length, quote: text }],
      support: 'reviewed',
      novelty: 'clear',
      rationale: 'Synthetic fixture.',
    },
  ],
  preparer: { role: 'prompt-author', independent: false },
};
function fixture() {
  const card: CardV4 = {
    schemaVersion: 4,
    id: 'case-a',
    question: 'Who designed the lamp in 1842?',
    answer: 'Mira Vale',
    explanation: text,
    variants: [],
    scaffolding: [],
    claims: [],
  };
  const review: ReviewV4 = {
    schemaVersion: 4,
    id: card.id,
    fields: (['question', 'answer', 'explanation'] as const).map((field) => ({
      field,
      complete: true,
      reason: 'All assertions reconstructed.',
      claims: [
        {
          cardQuote: card[field],
          assertion: text,
          status: 'supported',
          evidence: [{ sourceId: source.id, quote: text }],
          reason: 'Direct source relationship.',
        },
      ],
      acceptance:
        field === 'answer'
          ? {
              entity: 'match',
              answerType: 'match',
              language: 'match',
              specificity: 'match',
              reason: 'Correct named designer.',
            }
          : null,
    })),
  };
  card.claims = review.fields.map((f) => ({
    field: f.field,
    cardQuote: f.claims[0].cardQuote,
    assertion: text,
    factIds: ['fact-a'],
  }));
  return { card, review };
}
function catalog(card: CardV4, review: ReviewV4) {
  const result = inventoryCatalog(card, packet, JSON.stringify(review), 'end_turn');
  if (!result.valid) throw Error('Invalid test fixture');
  return result.catalog;
}
function audit(c: ReturnType<typeof catalog>): InventoryAudit {
  return {
    schemaVersion: 1,
    catalogSha: c.sha,
    reviewer: { name: 'Fixture author', independence: 'same-author' },
    claims: c.reviewers.map((r) => ({
      reviewId: r.id,
      writerIds: [c.writers.find((w) => w.field === r.field)!.id],
      status: 'covered',
      reason: 'Same factual relationship in this field.',
    })),
  };
}

describe('assertion-based inventory reconciliation', () => {
  it('supplies full card context to separate reconciliation without source verdicts, labels or gold', () => {
    const { card, review } = fixture(),
      c = catalog(card, review);
    const input = JSON.parse(inventoryReconciliationInput(c, card));
    expect(input.card.question).toBe(card.question);
    expect(input.card.explanation).toBe(card.explanation);
    expect(input.writerClaims).toHaveLength(3);
    expect(input.reconstructedClaims).toHaveLength(3);
    expect(input).not.toHaveProperty('decision');
    expect(input).not.toHaveProperty('gold');
    expect(input).not.toHaveProperty('arm');
    expect(() => inventoryReconciliationInput(c, { ...card, question: 'Changed ask?' })).toThrow();
  });
  it('removes quote-boundary false alarms for identical same-field assertions', () => {
    const { card, review } = fixture();
    card.claims[2].cardQuote = 'the lamp';
    expect(
      assessEvidenceV4(JSON.stringify(review), 'end_turn', card, packet, 'strict').findings.some(
        (f) => f.category === 'inventory_omission',
      ),
    ).toBe(true);
    const result = assessCoverageRepair(JSON.stringify(review), 'end_turn', card, packet);
    expect(result.decision).toBe('pass');
    expect(result.reconciliation?.complete).toBe(true);
    expect(result.notServingApproval).toBe(true);
    expect(result.reconciliation?.semanticReview).toBe('unassessed');
  });
  it('does not use an overlapping quote as proof that different assertions are covered', () => {
    const { card, review } = fixture();
    card.claims[0].assertion = 'Nora Reed designed the lamp in 1842.';
    const result = reconcileInventory(catalog(card, review));
    expect(result.unresolved).toBe(1);
    expect(result.missing).toBe(0);
    expect(result.complete).toBe(false);
  });
  it('keeps paraphrases unresolved until a bound explicit assertion review', () => {
    const { card, review } = fixture();
    card.claims[0].assertion = 'The lamp was designed by Mira Vale in 1842.';
    card.claims[0].cardQuote = 'the lamp';
    const c = catalog(card, review);
    expect(reconcileInventory(c).unresolved).toBe(1);
    const result = reconcileInventory(c, audit(c));
    expect(result.complete).toBe(true);
    expect(result.semanticReview).toBe('same-author');
  });
  it.each([
    'Mira Vale designed the lamp in 1843.',
    'Mira Vale did not design the lamp in 1842.',
    'Nora Reed designed the lamp in 1842.',
    'Mira Vale designed the lens in 1842.',
    'Mira Vale later designed the lamp in 1842.',
    'Studio A merged into Studio C.',
  ])('does not erase changed relations or qualifiers: %s', (assertion) => {
    const { card, review } = fixture();
    card.claims[0].assertion = assertion;
    expect(reconcileInventory(catalog(card, review)).unresolved).toBe(1);
  });
  it('allows explicit omission findings without converting uncertain matches into missing claims', () => {
    const { card, review } = fixture();
    card.claims[2].assertion = 'Mira Vale designed a different object.';
    const c = catalog(card, review),
      a = audit(c);
    a.claims[2] = {
      ...a.claims[2],
      writerIds: [],
      status: 'missing',
      reason: 'The explanation-field relation is not inventoried.',
    };
    expect(reconcileInventory(c).missing).toBe(0);
    const result = assessCoverageRepair(JSON.stringify(review), 'end_turn', card, packet, a);
    expect(result.decision).toBe('review');
    expect(result.reconciliation?.missing).toBe(1);
    expect(result.findings.some((f) => f.category === 'inventory_omission')).toBe(true);
  });
  it('rejects cross-field mapping, stale responses/cards and partial/duplicate audits', () => {
    const { card, review } = fixture(),
      c = catalog(card, review);
    const cross = audit(c);
    cross.claims[2].writerIds = [c.writers.find((w) => w.field === 'answer')!.id];
    expect(() => reconcileInventory(c, cross)).toThrow();
    const partial = audit(c);
    partial.claims.pop();
    expect(() => reconcileInventory(c, partial)).toThrow();
    const duplicate = audit(c);
    duplicate.claims[1] = duplicate.claims[0];
    expect(() => reconcileInventory(c, duplicate)).toThrow();
    const changed = structuredClone(card);
    changed.explanation += ' Extra.';
    expect(() => reconcileInventory(catalog(changed, review), audit(c))).toThrow();
    review.fields[0].reason = 'Changed response.';
    expect(() => reconcileInventory(catalog(card, review), audit(c))).toThrow();
    expect(() => reconcileInventory({ ...c, writers: c.writers.slice(1) })).toThrow();
  });
  it('supports several same-field writer records per independently reconstructed relationship', () => {
    const { card, review } = fixture();
    card.claims[0].assertion = 'Mira Vale designed the lamp.';
    card.claims.push({
      field: 'question',
      cardQuote: '1842',
      assertion: 'The lamp design was in 1842.',
      factIds: ['fact-a'],
    });
    const c = catalog(card, review),
      a = audit(c);
    a.claims[0].writerIds = c.writers.filter((w) => w.field === 'question').map((w) => w.id);
    expect(reconcileInventory(c, a).complete).toBe(true);
  });
  it('retains malformed source responses and structurally incomplete inventories as reviews', () => {
    const { card, review } = fixture();
    expect(assessCoverageRepair('{}', 'end_turn', card, packet).decision).toBe('review');
    expect(assessCoverageRepair(JSON.stringify(review), 'max_tokens', card, packet).decision).toBe(
      'review',
    );
    card.claims.pop();
    expect(
      assessCoverageRepair(JSON.stringify(review), 'end_turn', card, packet).catalog,
    ).toBeNull();
  });
  it('does not downgrade contradiction, missing evidence or variant findings during inventory reconciliation', () => {
    const { card, review } = fixture();
    review.fields[2].claims[0].status = 'contradicted';
    expect(assessCoverageRepair(JSON.stringify(review), 'end_turn', card, packet).decision).toBe(
      'hold',
    );
    review.fields[2].claims[0].status = 'unknown';
    review.fields[2].claims[0].evidence = [];
    expect(assessCoverageRepair(JSON.stringify(review), 'end_turn', card, packet).decision).toBe(
      'review',
    );
  });
  it('retains whole-card reconstruction blinding; reconciliation is a separate step', () => {
    const { card } = fixture(),
      input = JSON.parse(reconstructionInputV4(card, packet.sources));
    expect(input).not.toHaveProperty('claims');
    expect(input).not.toHaveProperty('scaffolding');
    expect(input).not.toHaveProperty('reviewer');
    expect(input).not.toHaveProperty('gold');
  });
  it('leaves extra reviewer context unresolved instead of inventing an omitted card claim', () => {
    const { card, review } = fixture();
    review.fields[0].claims[0].assertion += ' The design used a brass frame.';
    const c = catalog(card, review),
      a = audit(c);
    a.claims[0].status = 'uncertain';
    a.claims[0].reason =
      'The reconstructed assertion adds source context not asserted by the question; split it before matching.';
    const result = reconcileInventory(c, a);
    expect(result.missing).toBe(0);
    expect(result.unresolved).toBe(1);
    expect(result.complete).toBe(false);
  });
  it('distinguishes entity formation from absorption even when quotes and actors overlap', () => {
    const formation = 'Guild A and Guild B formed Guild C in 1949.';
    const s = readableSource({ ...source, rawText: formation, extractionSha: sha(formation) });
    const p = structuredClone(packet);
    p.sources = [s];
    p.facts[0].assertion = formation;
    p.facts[0].evidence = [{ sourceId: s.id, start: 0, end: formation.length, quote: formation }];
    const { card, review } = fixture();
    card.question = 'Which guild did A and B form in 1949?';
    card.answer = 'Guild C';
    card.explanation = 'Guild A merged into Guild C in 1949.';
    card.claims = card.claims.map((c) => ({
      ...c,
      cardQuote: card[c.field as 'question' | 'answer' | 'explanation'],
      assertion: c.field === 'explanation' ? card.explanation : formation,
    }));
    review.fields = review.fields.map((f) => ({
      ...f,
      claims: [
        {
          ...f.claims[0],
          cardQuote: card[f.field as 'question' | 'answer' | 'explanation'],
          assertion: formation,
          evidence: [{ sourceId: s.id, quote: formation }],
        },
      ],
    }));
    const result = inventoryCatalog(card, p, JSON.stringify(review), 'end_turn');
    expect(result.valid).toBe(true);
    if (!result.valid) throw Error('Invalid formation fixture');
    expect(reconcileInventory(result.catalog).unresolved).toBe(1);
    review.fields[2].claims[0].assertion = card.explanation;
    review.fields[2].claims[0].status = 'contradicted';
    expect(assessCoverageRepair(JSON.stringify(review), 'end_turn', card, p).sourceDecision).toBe(
      'hold',
    );
  });
});
