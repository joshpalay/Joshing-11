import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readableSource } from './cassian-evidence-v3';
import { excerptSource, type PreparedPacket } from './cassian-source-packets';
import { coverageHash } from './cassian-claim-reconciliation';
import {
  assessPacketCompleteness,
  checkedPacketWriterInput,
  completePacketEvidence,
  locateRequiredEvidence,
  type CompletenessPlan,
} from './cassian-source-completeness';

const text =
  'The trial ran in 2024. Displays increased fruit selection. Displays increased vegetable selection. Displays had no effect on consumption. Use displays to promote produce selection.';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const parent = readableSource({
  id: 'parent-a',
  url: 'https://example.com/trial',
  title: 'Trial fixture',
  section: 'Results',
  edition: null,
  rawText: text,
  captureSha: sha(text),
  extractionSha: sha(text),
  removed: [],
  locator: 'fixture-parent',
});
const range = (quote: string) => {
  const start = parent.readableText.indexOf(quote);
  if (start < 0) throw Error('Missing fixture text');
  return { parentId: parent.id, start, end: start + quote.length, quote };
};
function fixture() {
  const fruit = range('Displays increased fruit selection.'),
    consumption = range('Displays had no effect on consumption.'),
    vegetable = range('Displays increased vegetable selection.');
  const excerpts = [fruit, consumption].map((e, n) =>
    excerptSource(parent, { start: e.start, end: e.end }, `source-${n}`),
  );
  const assertion =
    'Displays increased fruit and vegetable selection but did not increase consumption.';
  const packet: PreparedPacket = {
    requestId: 'request-a',
    domain: 'Trials',
    tier: 'specialist',
    scope: 'accepted',
    sources: excerpts.map((e) => e.source),
    facts: [
      {
        id: 'fact-a',
        assertion,
        evidence: excerpts.map((e) => ({
          sourceId: e.source.id,
          start: 0,
          end: e.source.readableText.length,
          quote: e.source.readableText,
        })),
        support: 'reviewed',
        novelty: 'clear',
        rationale: 'Synthetic source-completeness fixture.',
      },
    ],
    preparer: { role: 'prompt-author', independent: false },
  };
  const plan: CompletenessPlan = {
    schemaVersion: 1,
    packetSha: coverageHash(packet),
    revisionOfPacketSha: null,
    reviewer: { name: 'Fixture author', independence: 'same-author' },
    parents: [{ id: parent.id, readableSha: parent.readableSha }],
    sources: excerpts.map((e) => ({
      sourceId: e.source.id,
      parentId: e.parentId,
      start: e.range.start,
      end: e.range.end,
    })),
    facts: [
      {
        factId: 'fact-a',
        assertionSha: coverageHash(assertion),
        complete: true,
        reason: 'All stated measured results are decomposed.',
        components: [fruit, vegetable, consumption].map((e, n) => ({
          id: `component-${n}`,
          assertion: e.quote,
          kind: n === 1 ? ('qualifier' as const) : ('relationship' as const),
          status: 'supported' as const,
          basis: 'direct_relationship' as const,
          evidence: [e],
          reason: 'Direct result sentence in the captured parent.',
        })),
      },
    ],
  };
  return { packet, plan };
}
const categories = (packet: PreparedPacket, plan: CompletenessPlan) =>
  assessPacketCompleteness(packet, [parent], plan).findings.map((f) => f.category);

describe('required source passages before writer input', () => {
  it('locates real parent quotes without model offsets and refuses absent or repeated context', () => {
    const quote = 'Displays increased vegetable selection.';
    expect(locateRequiredEvidence(parent, quote)).toEqual(range(quote));
    expect(() =>
      locateRequiredEvidence(parent, 'Displays decreased vegetable selection.'),
    ).toThrow();
    const repeated = readableSource({
      ...parent,
      rawText: text + ' ' + text,
      extractionSha: sha(text + ' ' + text),
    });
    expect(() => locateRequiredEvidence(repeated, quote)).toThrow();
  });
  it('blocks a supported qualifier clipped out of the supplied sources', () => {
    const { packet, plan } = fixture();
    expect(categories(packet, plan)).toContain('missing_packet_evidence');
    expect(() => checkedPacketWriterInput(packet, [parent], plan)).toThrow('withheld');
  });
  it('adds the actual missing parent passage in a new revision without changing original labels or sources', () => {
    const { packet, plan } = fixture(),
      before = JSON.stringify({ packet, plan });
    const result = completePacketEvidence(packet, [parent], plan);
    expect(result.assessment.ready).toBe(true);
    expect(result.packet.sources).toHaveLength(3);
    expect(result.plan.revisionOfPacketSha).toBe(coverageHash(packet));
    expect(result.plan.packetSha).toBe(coverageHash(result.packet));
    expect(JSON.stringify({ packet, plan })).toBe(before);
    expect(result.packet.facts[0].assertion).toBe(packet.facts[0].assertion);
    expect(result.packet.facts[0].novelty).toBe('clear');
    expect(result.assessment.notServingApproval).toBe(true);
  });
  it('transmits bound components and supplied spans, without parent captures or audit identity', () => {
    const { packet, plan } = fixture(),
      revision = completePacketEvidence(packet, [parent], plan);
    const input = JSON.parse(checkedPacketWriterInput(revision.packet, [parent], revision.plan));
    expect(input.eligibleFacts[0].requiredComponents).toHaveLength(3);
    expect(input.eligibleFacts[0].requiredComponents[1].evidence[0].quote).toBe(
      'Displays increased vegetable selection.',
    );
    expect(input).not.toHaveProperty('parents');
    expect(input).not.toHaveProperty('reviewer');
    expect(JSON.stringify(input)).not.toContain('Fixture author');
    expect(input.sources.some((s: { id: string }) => s.id === parent.id)).toBe(false);
  });
  it('is idempotent and retains original revision provenance when all passages are present', () => {
    const { packet, plan } = fixture(),
      first = completePacketEvidence(packet, [parent], plan);
    const second = completePacketEvidence(first.packet, [parent], first.plan);
    expect(second.packet).toEqual(first.packet);
    expect(second.plan).toEqual(first.plan);
  });
  it.each(['recommendation', 'subject_mention', 'none'] as const)(
    'rejects supported claims relying on %s instead of a direct relationship',
    (basis) => {
      const { packet, plan } = fixture();
      plan.facts[0].components[1].basis = basis;
      expect(categories(packet, plan)).toContain('indirect_support');
      expect(() => completePacketEvidence(packet, [parent], plan)).toThrow();
    },
  );
  it.each(['unknown', 'contradicted'] as const)(
    'does not manufacture evidence or relabel a %s claim',
    (status) => {
      const { packet, plan } = fixture();
      plan.facts[0].components[1].status = status;
      expect(assessPacketCompleteness(packet, [parent], plan).ready).toBe(false);
      expect(() => completePacketEvidence(packet, [parent], plan)).toThrow();
    },
  );
  it('requires whole-fact decomposition and a relationship, not just convenient qualifiers', () => {
    const { packet, plan } = fixture();
    plan.facts[0].complete = false;
    expect(categories(packet, plan)).toContain('incomplete_fact_decomposition');
    expect(() => completePacketEvidence(packet, [parent], plan)).toThrow();
    plan.facts[0].complete = true;
    plan.facts[0].components = [plan.facts[0].components[1]];
    expect(categories(packet, plan)).toContain('invalid_source_plan');
  });
  it('requires citations even for a supported direct relationship', () => {
    const { packet, plan } = fixture();
    plan.facts[0].components[1].evidence = [];
    expect(categories(packet, plan)).toContain('missing_evidence');
    expect(() => completePacketEvidence(packet, [parent], plan)).toThrow();
  });
  it('rejects stale packets, assertions, parent identity and changed quotations', () => {
    const { packet, plan } = fixture();
    for (const change of [
      (p: CompletenessPlan) => {
        p.packetSha = '0'.repeat(64);
      },
      (p: CompletenessPlan) => {
        p.facts[0].assertionSha = '0'.repeat(64);
      },
      (p: CompletenessPlan) => {
        p.parents[0].readableSha = '0'.repeat(64);
      },
      (p: CompletenessPlan) => {
        p.facts[0].components[0].evidence[0].quote = 'Displays decreased fruit selection.';
      },
      (p: CompletenessPlan) => {
        p.sources[0].start++;
      },
    ]) {
      const changed = structuredClone(plan);
      change(changed);
      expect(categories(packet, changed)).toContain('invalid_source_plan');
    }
  });
  it('rejects duplicate identities and omitted fact/source audit records', () => {
    const { packet, plan } = fixture();
    for (const change of [
      (p: CompletenessPlan) => {
        p.facts.push(p.facts[0]);
      },
      (p: CompletenessPlan) => {
        p.facts = [];
      },
      (p: CompletenessPlan) => {
        p.sources.pop();
      },
      (p: CompletenessPlan) => {
        p.facts[0].components.push(p.facts[0].components[0]);
      },
    ]) {
      const changed = structuredClone(plan);
      change(changed);
      expect(categories(packet, changed)).toContain('invalid_source_plan');
    }
  });
  it('checks the fact-reference evidence binding even when the passage is already in the packet', () => {
    const { packet, plan } = fixture(),
      revised = completePacketEvidence(packet, [parent], plan);
    revised.packet.facts[0].evidence.pop();
    revised.plan.packetSha = coverageHash(revised.packet);
    expect(categories(revised.packet, revised.plan)).toContain('missing_fact_evidence_binding');
    expect(completePacketEvidence(revised.packet, [parent], revised.plan).assessment.ready).toBe(
      true,
    );
  });
  it('never joins distant source spans into a fabricated contiguous quote', () => {
    const { packet, plan } = fixture();
    const e = plan.facts[0].components[0].evidence[0];
    e.quote = 'Displays increased fruit selection. Displays had no effect on consumption.';
    e.end = e.start + e.quote.length;
    expect(categories(packet, plan)).toContain('invalid_source_plan');
  });
  it('preserves novelty exclusions and does not turn an unresolved topic into eligible stock', () => {
    const { packet, plan } = fixture();
    packet.facts.push({
      ...structuredClone(packet.facts[0]),
      id: 'duplicate',
      novelty: 'bank_duplicate',
    });
    plan.packetSha = coverageHash(packet);
    const revised = completePacketEvidence(packet, [parent], plan);
    const input = JSON.parse(checkedPacketWriterInput(revised.packet, [parent], revised.plan));
    expect(input.eligibleFacts).toHaveLength(1);
    expect(input.excludedFacts).toHaveLength(1);
    packet.scope = 'unresolved';
    plan.packetSha = coverageHash(packet);
    plan.facts = [];
    expect(categories(packet, plan)).toContain('preparation_shortage');
    expect(() => completePacketEvidence(packet, [parent], plan)).toThrow();
  });
});
