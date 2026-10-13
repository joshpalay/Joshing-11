import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readableSource } from './cassian-evidence-v3';
import { coverageHash } from './cassian-claim-reconciliation';
import { cardScopeCatalog } from './cassian-card-scope';
import {
  assessModelScope,
  assessRoleReview,
  assessScopeQuality,
  modelScopeInput,
} from './cassian-scope-protocol';
import {
  validateScopeDesign,
  knownScopeJobs,
  maximumScope,
  scopeParams,
  scopeBytes,
  scopeJobs,
  validateScopeProgress,
  scoreScope,
  hash,
  type ScopeDesign,
  type ScopeJob,
  type Progress,
} from './cassian-scope-probe-core';
const line = 'Mira Vale designed the lamp in 1842.';
const source = readableSource({
  id: 'source-a',
  url: 'https://example.com/fixture',
  title: 'Fixture',
  section: 'Design',
  edition: null,
  rawText: line,
  captureSha: hash(line),
  extractionSha: hash(line),
  removed: [],
  locator: 'fixture',
});
function fixture(): ScopeDesign {
  const cases = Array.from({ length: 12 }, (_, i) => {
    const card = {
      schemaVersion: 4 as const,
      id: 'item-' + i.toString(16).padStart(16, '0'),
      question: 'Who designed the lamp in 1842?',
      answer: 'Mira Vale',
      explanation: line,
      variants: [],
      scaffolding: [],
      claims:
        i < 8
          ? []
          : (['question', 'answer', 'explanation'] as const).map((field) => ({
              field,
              cardQuote: field === 'question' ? '1842' : field === 'answer' ? 'Mira Vale' : line,
              assertion: line,
              factIds: ['fact-a'],
            })),
    };
    const packet = {
      requestId: 'request-' + i,
      domain: 'Design',
      tier: 'specialist',
      scope: 'accepted' as const,
      sources: [source],
      facts: [
        {
          id: 'fact-a',
          assertion: line,
          evidence: [{ sourceId: source.id, start: 0, end: line.length, quote: line }],
          support: 'reviewed' as const,
          novelty: 'clear' as const,
          rationale: 'Synthetic',
        },
      ],
      preparer: { role: 'prompt-author' as const, independent: false as const },
    };
    return {
      privateId: 'private-' + i,
      card,
      sources: [source],
      domain: 'Design',
      tier: 'specialist' as const,
      relationRequired: i < 3,
      packet: i < 8 ? null : packet,
    };
  });
  return validateScopeDesign({
    schemaVersion: 1,
    id: 'cassian-scope-probe-' + randomUUID(),
    seed: 'fixture',
    maxRunUsd: 1.35,
    timeoutMs: 60000,
    scope: 'saved-scope-policy-integration-not-production-reliability',
    priorDesignSha: hash('prior'),
    policyFreezeSha: hash('policy'),
    files: [{ path: 'scripts/pin.ts', sha: hash('fixture') }],
    cases,
  });
}
function sourceRaw(c: ScopeDesign['cases'][number]) {
  return JSON.stringify({
    schemaVersion: 4,
    id: c.card.id,
    fields: (['question', 'answer', 'explanation'] as const).map((field) => ({
      field,
      complete: true,
      claims: [
        {
          cardQuote: c.card[field],
          assertion: line,
          status: 'supported',
          basis: 'direct_relationship',
          evidence: [{ sourceId: source.id, quote: line }],
          reason: 'Direct',
        },
      ],
      acceptance:
        field === 'answer'
          ? {
              entity: 'match',
              answerType: 'match',
              language: 'match',
              specificity: 'match',
              reason: 'Correct identity',
            }
          : null,
      reason: 'Complete',
    })),
  });
}
function receipt(j: ScopeJob, raw: string, stop = 'end_turn') {
  return {
    designSha: hash('design'),
    key: j.key,
    requestSha: j.sha,
    raw,
    rawSha: hash(raw),
    model: j.model,
    requestId: 'receipt',
    stopReason: stop,
    usd: 0.00012,
    elapsedMs: 1,
    usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0 },
  };
}
function prepared() {
  const d = fixture(),
    p: Progress = { calls: {}, blocked: {} };
  for (const c of d.cases.filter((c) => c.packet)) {
    const j = knownScopeJobs(d).find((j) => j.key === 'source-' + c.card.id)!;
    p.calls[j.key] = receipt(j, sourceRaw(c));
  }
  return { d, p };
}
describe('frozen saved scope probe', () => {
  it('bounds 17 known and four dynamic calls including native schemas and all added checking cost', () => {
    const d = fixture(),
      jobs = knownScopeJobs(d);
    expect(jobs).toHaveLength(17);
    expect(maximumScope(d).maximumCalls).toBe(21);
    expect(maximumScope(d).reserveUsd).toBeCloseTo(1.333, 6);
    for (const j of jobs) {
      expect(scopeParams(j).output_config?.format).toEqual(j.format);
      expect(scopeBytes(j)).toBeLessThan(40000);
      expect(j.model).toBe('claude-sonnet-5-5');
    }
    expect(jobs.some((j) => j.kind === 'writer')).toBe(false);
  });
  it('blinds independent reconstruction, quality and relation extraction to inventories/cohorts', () => {
    const d = fixture();
    for (const j of knownScopeJobs(d)) {
      expect(j.body).not.toContain('private-');
      const body = JSON.parse(j.body);
      if (j.stage === 'quality') {
        expect(body.items[0]).not.toHaveProperty('explanation');
        expect(body.items[0]).not.toHaveProperty('variants');
      } else {
        expect(body).not.toHaveProperty('claims');
        expect(body).not.toHaveProperty('gold');
      }
    }
  });
  it('binds dynamic scope catalogs to complete actual native receipts without transmitting source decisions', () => {
    const { d, p } = prepared(),
      jobs = validateScopeProgress(d, p, hash('design'));
    expect(jobs).toHaveLength(21);
    for (const j of jobs.filter((j) => j.stage === 'scope')) {
      expect(j.parents).toHaveLength(1);
      const body = JSON.parse(j.body);
      expect(body).not.toHaveProperty('sourceDecision');
      expect(body.reconstructedClaims[0]).not.toHaveProperty('status');
      expect(body.reconstructedClaims[0]).not.toHaveProperty('evidence');
    }
    const old = jobs.find((j) => j.stage === 'scope')!,
      r = p.calls[old.parents[0].key];
    r.raw += '\n';
    r.rawSha = hash(r.raw);
    expect(scopeJobs(d, p).find((j) => j.key === old.key)!.sha).not.toBe(old.sha);
  });
  it('retains missing conditional scope denominators and never grants passes for nonfinal/malformed source replies', () => {
    const { d, p } = prepared(),
      r = Object.values(p.calls)[0];
    r.stopReason = 'max_tokens';
    const jobs = scopeJobs(d, p);
    expect(jobs.filter((j) => j.stage === 'scope')).toHaveLength(3);
    expect(scoreScope(d, p, jobs).find((c) => c.blindId === d.cases[8].card.id)?.scope).toBeNull();
    expect(scoreScope(d, p, jobs).every((c) => c.machinePass === false)).toBe(true);
  });
  it('rejects bad receipt identities, changed sources, unsafe paths and invalid saved inventories', () => {
    const { d, p } = prepared();
    Object.values(p.calls)[0].rawSha = hash('wrong');
    expect(() => validateScopeProgress(d, p, hash('design'))).toThrow();
    const unsafe = fixture();
    unsafe.files[0].path = '../outside';
    expect(() => validateScopeDesign(unsafe)).toThrow();
    const bad = fixture();
    bad.cases[8].card.claims[0].factIds = ['unknown'];
    expect(() => validateScopeDesign(bad)).toThrow('saved inventory');
    const changed = fixture();
    changed.cases[8].packet!.sources = [];
    expect(() => validateScopeDesign(changed)).toThrow();
  });
  it('keeps default, score-only and zero-limit execution free with poisoned credentials', () => {
    const root = '_scratch/Cassian/scope-free-' + randomUUID();
    mkdirSync(root, { recursive: true });
    const pin = root + '/pin.txt';
    writeFileSync(pin, 'fixture');
    const d = fixture();
    d.files = [{ path: pin, sha: hash('fixture') }];
    const path = root + '/design.json';
    writeFileSync(path, JSON.stringify(d));
    for (const flags of [[], ['--score-only'], ['--run', '--limit', '0']]) {
      const r = spawnSync(
        process.execPath,
        [
          resolve('node_modules/tsx/dist/cli.mjs'),
          'scripts/cassian-scope-probe-calls.ts',
          ...flags,
        ],
        {
          encoding: 'utf8',
          timeout: 15000,
          env: {
            ...process.env,
            CASSIAN_SCOPE_DESIGN: path,
            CASSIAN_ENV_FILE: 'nonexistent',
            ANTHROPIC_API_KEY: 'poison',
            DATABASE_URL: 'poison',
          },
        },
      );
      expect(r.status, r.stderr).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.paidCalls).toBe(0);
      expect(out.tokenCalls).toBe(0);
    }
  }, 30000);
});
describe('model scope and role contracts', () => {
  it('stamps reviewer provenance, accepts complete bound scope and rejects claimed independence/stale/partial mappings', () => {
    const c = fixture().cases[8],
      catalog = cardScopeCatalog(c.card, c.packet!, sourceRaw(c), 'end_turn');
    const input = JSON.parse(modelScopeInput(catalog));
    expect(input.card.question).toBe(c.card.question);
    const components = catalog.reviewers.map((r, i) => ({
      id: 'component-' + i,
      field: r.field,
      cardQuote: r.cardQuote,
      assertion: r.assertion,
      role: 'stated',
      reviewIds: [r.id],
      reason: 'Same assertion',
    }));
    const mappings = components.map((c, i) => ({
      componentId: c.id,
      status: 'covered',
      writerIds: [catalog.writers[i].id],
      questionContextIds: [],
      reason: 'Same field',
    }));
    const reply = { schemaVersion: 1, catalogSha: catalog.sha, components, mappings };
    expect(assessModelScope(JSON.stringify(reply), 'end_turn', catalog).result?.complete).toBe(
      true,
    );
    expect(
      assessModelScope(
        JSON.stringify({ ...reply, reviewer: { name: 'model', independence: 'independent' } }),
        'end_turn',
        catalog,
      ).valid,
    ).toBe(false);
    expect(
      assessModelScope(
        JSON.stringify({ ...reply, mappings: mappings.slice(1) }),
        'end_turn',
        catalog,
      ).valid,
    ).toBe(false);
    expect(assessModelScope(JSON.stringify(reply), 'max_tokens', catalog).valid).toBe(false);
  });
  const card = () => ({ ...fixture().cases[0].card, explanation: 'A merged into C.' });
  const forming = readableSource({
    ...source,
    id: 'formation',
    rawText: 'A and B formed C.',
    captureSha: hash('A and B formed C.'),
    extractionSha: hash('A and B formed C.'),
    removed: [],
  });
  const roles = () => ({
    schemaVersion: 1,
    id: card().id,
    complete: true,
    comparisons: [
      {
        field: 'explanation',
        cardQuote: 'A merged into C.',
        cardRelation: { kind: 'accession', entrant: 'a', target: 'c', targetState: 'existing' },
        evidence: [
          {
            sourceId: forming.id,
            quote: 'A and B formed C.',
            relation: {
              kind: 'formation',
              participants: ['a', 'b'],
              result: 'c',
              resultState: 'new',
            },
          },
        ],
        reason: 'Different result/newness roles',
      },
    ],
  });
  it('holds an explicit role contradiction and retains unspecified roles as review', () => {
    expect(assessRoleReview(JSON.stringify(roles()), 'end_turn', card(), [forming]).decision).toBe(
      'hold',
    );
    const r = roles();
    r.comparisons[0].cardRelation.targetState = 'unspecified';
    expect(assessRoleReview(JSON.stringify(r), 'end_turn', card(), [forming]).decision).toBe(
      'review',
    );
  });
  it('rejects invented card/source quotations and nonfinal role extraction', () => {
    const r = roles();
    r.comparisons[0].evidence[0].quote = 'A formed C alone.';
    expect(assessRoleReview(JSON.stringify(r), 'end_turn', card(), [forming]).valid).toBe(false);
    expect(assessRoleReview(JSON.stringify(roles()), 'max_tokens', card(), [forming]).valid).toBe(
      false,
    );
  });
  it('does not let incomplete role reconstruction pass', () => {
    const r = roles();
    r.complete = false;
    r.comparisons[0].evidence[0].relation = {
      ...r.comparisons[0].evidence[0].relation,
      resultState: 'unspecified',
    };
    expect(assessRoleReview(JSON.stringify(r), 'end_turn', card(), [forming]).decision).toBe(
      'review',
    );
  });
});
describe('native ambiguity witness gating', () => {
  const input = {
    id: 'quality-a',
    question: 'Who created the work titled Aurora?',
    answer: 'Mira Vale',
    domain: 'Design',
    tier: 'specialist' as const,
  };
  const item = () => ({
    id: input.id,
    decision: 'hold',
    category: 'ambiguity',
    reason: 'Two works share the title.',
    evidence: ['the work titled Aurora'],
    ambiguity: {
      alternatives: [
        {
          answer: 'Mira Vale',
          referentId: 'a',
          interpretation: 'Sculpture',
          fitsUnchangedAsk: true,
          questionQuote: 'Aurora',
          reason: 'No medium given',
        },
        {
          answer: 'Ren Taro',
          referentId: 'b',
          interpretation: 'Painting',
          fitsUnchangedAsk: true,
          questionQuote: 'Aurora',
          reason: 'No medium given',
        },
      ],
    },
  });
  it('requires a real bound two-referent attestation for ambiguity while preserving the raw hold', () => {
    const wrap = (i: unknown) => JSON.stringify({ schemaVersion: 4, items: [i] });
    expect(assessScopeQuality(wrap(item()), 'end_turn', [input])[0].decision).toBe('hold');
    const same = item();
    same.ambiguity.alternatives[1].referentId = 'a';
    expect(assessScopeQuality(wrap(same), 'end_turn', [input])[0]).toMatchObject({
      decision: 'review',
      originalDecision: 'hold',
      issue: 'insufficient_ambiguity_witness',
    });
    expect(
      assessScopeQuality(wrap({ ...item(), ambiguity: null }), 'end_turn', [input])[0].decision,
    ).toBe('review');
  });
  it('requires clear passes to have no witness and keeps malformed batches unresolved', () => {
    const r = {
      schemaVersion: 4,
      items: [{ ...item(), decision: 'pass', category: 'clear', evidence: [], ambiguity: null }],
    };
    expect(assessScopeQuality(JSON.stringify(r), 'end_turn', [input])[0].decision).toBe('pass');
    r.items[0].id = 'wrong';
    expect(assessScopeQuality(JSON.stringify(r), 'end_turn', [input])[0].decision).toBe('review');
    expect(assessScopeQuality('{}', 'end_turn', [input])[0].decision).toBe('review');
    expect(coverageHash(input)).toHaveLength(64);
  });
});
