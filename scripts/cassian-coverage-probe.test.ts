import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { readableSource } from './cassian-evidence-v3';
import { excerptSource } from './cassian-source-packets';
import { coverageHash, reconcileInventory } from './cassian-claim-reconciliation';
import {
  assessCoverageSource,
  coverageInventoryCatalog,
  assessModelInventory,
  coverageSourceSchema,
  modelInventorySchema,
  type CoverageSourceReply,
} from './cassian-coverage-protocol';
import {
  validateCoverageDesign,
  maximumCoverage,
  knownCoverageJobs,
  coverageJobs,
  validateCoverageProgress,
  coverageParams,
  scoreCoverage,
  hash,
  validateReceipt,
  type CoverageDesign,
  type CoverageJob,
  type Progress,
} from './cassian-coverage-probe-core';
import { outputFormatV4, type CardV4 } from './cassian-evidence-v4';

const text = 'Mira Vale designed the lamp in 1842.';
const parent = readableSource({
  id: 'parent-a',
  url: 'https://example.com/history',
  title: 'Fixture',
  section: 'History',
  edition: null,
  rawText: text,
  captureSha: hash(text),
  extractionSha: hash(text),
  removed: [],
  locator: 'fixture',
});
const source = excerptSource(parent, { start: 0, end: text.length }, 'source-a').source;
const opaque = (s: string) => `item-${hash(s).slice(0, 16)}`;
const card = (id: string): CardV4 => ({
  schemaVersion: 4,
  id,
  question: 'Who designed the lamp in 1842?',
  answer: 'Mira Vale',
  explanation: text,
  variants: [],
  claims: [],
  scaffolding: [],
});
function fixture(): CoverageDesign {
  const d: CoverageDesign = {
    schemaVersion: 1,
    id: 'cassian-coverage-probe-fixture',
    seed: 'fixture',
    maxRunUsd: 1.1,
    timeoutMs: 60000,
    files: [{ path: 'scripts/cassian-coverage-probe-core.ts', sha: hash('fixture') }],
    priorDesignSha: hash('old'),
    priorGoldSha: hash('gold'),
    coverageContractSha: hash('coverage'),
    scope: 'known-case-coverage-integration-not-production-reliability',
    targets: [1, 2].map((n) => {
      const packet = {
        requestId: `request-${n}`,
        domain: 'Inventors',
        tier: 'moderate',
        scope: 'accepted' as const,
        sources: [source],
        facts: [
          {
            id: 'fact-a',
            assertion: text,
            evidence: [{ sourceId: source.id, start: 0, end: text.length, quote: text }],
            support: 'reviewed' as const,
            novelty: 'clear' as const,
            rationale: 'Fixture.',
          },
        ],
        preparer: { role: 'prompt-author' as const, independent: false as const },
      };
      return {
        slot: n,
        packet,
        parents: [parent],
        plan: {
          schemaVersion: 1 as const,
          packetSha: coverageHash(packet),
          revisionOfPacketSha: null,
          reviewer: { name: 'Fixture author', independence: 'same-author' as const },
          parents: [{ id: parent.id, readableSha: parent.readableSha }],
          sources: [{ sourceId: source.id, parentId: parent.id, start: 0, end: text.length }],
          facts: [
            {
              factId: 'fact-a',
              assertionSha: coverageHash(text),
              complete: true,
              reason: 'Single complete relationship.',
              components: [
                {
                  id: 'relation',
                  assertion: text,
                  kind: 'relationship' as const,
                  status: 'supported' as const,
                  basis: 'direct_relationship' as const,
                  evidence: [{ parentId: parent.id, start: 0, end: text.length, quote: text }],
                  reason: 'Direct fixture.',
                },
              ],
            },
          ],
        },
        blind: { soft: opaque(`${n}:soft`), strict: opaque(`${n}:strict`) },
      };
    }),
    controls: Array.from({ length: 8 }, (_, n) => ({
      privateId: `gold-${n}`,
      card: card(opaque(`control:${n}`)),
      sources: [source],
      domain: 'Inventors',
      tier: 'moderate' as const,
    })),
    inventoryControls: [],
  };
  d.inventoryControls = [0, 1].map((n) => {
    const c = card(opaque(`inventory:${n}`)),
      r = reply(c);
    c.claims = r.fields.map((f) => ({
      field: f.field,
      cardQuote: f.claims[0].cardQuote,
      assertion: text,
      factIds: ['fact-a'],
    }));
    if (n === 0) c.claims = c.claims.filter((f) => f.field !== 'question');
    const raw = JSON.stringify({
      ...r,
      fields: r.fields.map((f) => ({
        ...f,
        claims: f.claims.map(({ basis: _basis, ...plain }) => plain),
      })),
    });
    return {
      privateId: `inventory-${n}`,
      card: c,
      packet: d.targets[0].packet,
      sourceRaw: raw,
      sourceOriginalRawSha: hash('original'),
    };
  });
  return d;
}
const reply = (c: CardV4): CoverageSourceReply => ({
  schemaVersion: 4,
  id: c.id,
  fields: (['question', 'answer', 'explanation'] as const).map((field) => ({
    field,
    complete: true,
    reason: 'All material claims reconstructed.',
    claims: [
      {
        cardQuote: c[field],
        assertion: text,
        status: 'supported',
        basis: 'direct_relationship',
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
            reason: 'Correct designer as answer.',
          }
        : null,
  })),
});
const candidate = (j: CoverageJob) => {
  const c = card(j.bindings[0]);
  if (j.arm === 'strict')
    c.claims = reply(c).fields.map((f) => ({
      field: f.field,
      cardQuote: c[f.field as 'question' | 'answer' | 'explanation'],
      assertion: text,
      factIds: ['fact-a'],
    }));
  return JSON.stringify({ status: 'candidate', reason: '', card: c });
};
const empty = (): Progress => ({ calls: {}, blocked: {} });
const receipt = (j: CoverageJob, raw: string, stop = 'end_turn') =>
  validateReceipt(
    {
      designSha: hash('design'),
      key: j.key,
      requestSha: j.sha,
      raw,
      rawSha: hash(raw),
      model: j.model,
      requestId: 'fixture',
      stopReason: stop,
      usd: j.stage === 'writing' ? 0.0000006 : 0.000012,
      elapsedMs: 1,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0 },
    },
    j,
    hash('design'),
  );
function written() {
  const d = validateCoverageDesign(fixture()),
    p = empty();
  for (const j of knownCoverageJobs(d).filter((j) => j.stage === 'writing'))
    p.calls[j.key] = receipt(j, candidate(j));
  return { d, p };
}

describe('source basis and bound model reconciliation', () => {
  it('accepts direct support with real quotes and keeps serving approval separate', () => {
    const c = card('case-a'),
      assessed = assessCoverageSource(JSON.stringify(reply(c)), 'end_turn', c, [source]);
    expect(assessed.decision).toBe('pass');
    expect(assessed.responseFormatValid).toBe(true);
    expect(assessed.notServingApproval).toBe(true);
  });
  it.each(['recommendation', 'subject_mention', 'none'] as const)(
    'blocks a supported explanation relying on %s',
    (basis) => {
      const c = card('case-a'),
        r = reply(c);
      r.fields[2].claims[0].basis = basis;
      const a = assessCoverageSource(JSON.stringify(r), 'end_turn', c, [source]);
      expect(a.decision).toBe('review');
      expect(a.findings.some((f) => f.category === 'indirect_support')).toBe(true);
      expect(a.findings.some((f) => f.category === 'missing_evidence')).toBe(true);
    },
  );
  it('does not turn indirect evidence into a proved contradiction', () => {
    const c = card('case-a'),
      r = reply(c);
    r.fields[2].claims[0].basis = 'recommendation';
    r.fields[2].claims[0].status = 'contradicted';
    const a = assessCoverageSource(JSON.stringify(r), 'end_turn', c, [source]);
    expect(a.decision).toBe('review');
    expect(a.findings.some((f) => f.category === 'factual_error')).toBe(false);
  });
  it('retains quote, binding and nonfinal response failures and folds only protocol enums', () => {
    const c = card('case-a'),
      r = reply(c);
    r.fields[2].claims[0].evidence[0].quote = 'A fabricated quotation.';
    expect(assessCoverageSource(JSON.stringify(r), 'end_turn', c, [source]).protocolValid).toBe(
      false,
    );
    expect(
      assessCoverageSource(JSON.stringify(reply(c)), 'max_tokens', c, [source]).responseFormatValid,
    ).toBe(false);
    const folded = JSON.stringify(reply(c))
      .replaceAll('direct_relationship', 'Direct_Relationship')
      .replaceAll('supported', 'Supported');
    expect(assessCoverageSource(folded, 'end_turn', c, [source]).decision).toBe('pass');
  });
  it('binds catalogs to the actual source receipt rather than a transformed response', () => {
    const { d, p } = written(),
      t = d.targets[0],
      w = knownCoverageJobs(d).find(
        (j) => j.stage === 'writing' && j.arm === 'strict' && j.requestId === t.packet.requestId,
      )!;
    const c = JSON.parse(p.calls[w.key].raw).card as CardV4,
      raw = JSON.stringify(reply(c)),
      result = coverageInventoryCatalog(raw, 'end_turn', c, t.packet);
    expect(result.catalog?.rawSha).toBe(hash(raw));
    expect(result.catalog?.rawSha).not.toBe(hash(result.source.projection!));
    expect(reconcileInventory(result.catalog!).complete).toBe(true);
  });
  it('requires complete same-field model mappings without letting the model claim independence', () => {
    const { d, p } = written(),
      t = d.targets[0],
      w = knownCoverageJobs(d).find(
        (j) => j.stage === 'writing' && j.arm === 'strict' && j.requestId === t.packet.requestId,
      )!;
    const c = JSON.parse(p.calls[w.key].raw).card,
      catalog = coverageInventoryCatalog(
        JSON.stringify(reply(c)),
        'end_turn',
        c,
        t.packet,
      ).catalog!;
    const model = {
      schemaVersion: 1,
      catalogSha: catalog.sha,
      claims: catalog.reviewers.map((r) => ({
        reviewId: r.id,
        writerIds: [catalog.writers.find((w) => w.field === r.field)!.id],
        status: 'covered',
        reason: 'Same field relationship.',
      })),
    };
    expect(
      assessModelInventory(JSON.stringify(model), 'end_turn', catalog).result?.semanticReview,
    ).toBe('same-author');
    expect(
      assessModelInventory(
        JSON.stringify({ ...model, reviewer: { independence: 'independent' } }),
        'end_turn',
        catalog,
      ).valid,
    ).toBe(false);
    model.claims[0].writerIds = [catalog.writers.find((w) => w.field === 'answer')!.id];
    expect(assessModelInventory(JSON.stringify(model), 'end_turn', catalog).valid).toBe(false);
    model.claims.pop();
    expect(assessModelInventory(JSON.stringify(model), 'end_turn', catalog).valid).toBe(false);
  });
  it('serializes native schemas without parser callbacks', () => {
    for (const schema of [coverageSourceSchema, modelInventorySchema]) {
      const f = outputFormatV4(schema);
      expect(f.type).toBe('json_schema');
      expect(f).not.toHaveProperty('parse');
    }
  });
});

describe('bounded coverage integration', () => {
  it('fits twenty-two calls under the $1.10 cap and checks preparation before writer requests', () => {
    const d = validateCoverageDesign(fixture());
    expect(maximumCoverage(d).maximumCalls).toBe(22);
    expect(maximumCoverage(d).reserveUsd).toBeLessThan(1.1);
    const jobs = knownCoverageJobs(d);
    expect(jobs).toHaveLength(14);
    expect(jobs.slice(0, 4).map((j) => j.arm)).toEqual(['soft', 'strict', 'strict', 'soft']);
    expect(JSON.parse(jobs[0].body).packet.eligibleFacts[0].requiredComponents).toHaveLength(1);
    for (const j of jobs) {
      expect(coverageParams(j).output_config?.format?.type).toBe('json_schema');
      expect(coverageParams(j)).not.toHaveProperty('tools');
    }
    d.targets[0].plan.facts[0].complete = false;
    expect(() => validateCoverageDesign(d)).toThrow('withheld');
  });
  it('materializes source reviews then separate strict reconciliation with both receipt dependencies', () => {
    const { d, p } = written();
    let jobs = coverageJobs(d, p);
    expect(jobs).toHaveLength(20);
    expect(jobs.some((j) => j.stage === 'reconciliation' && j.arm === 'strict')).toBe(false);
    for (const j of jobs.filter((j) => j.stage === 'source' && j.arm === 'strict')) {
      const w = j.parents[0].key;
      const c = JSON.parse(p.calls[w].raw).card;
      p.calls[j.key] = receipt(j, JSON.stringify(reply(c)));
    }
    jobs = validateCoverageProgress(d, p, hash('design'));
    expect(jobs).toHaveLength(22);
    for (const j of jobs.filter((j) => j.stage === 'reconciliation' && j.arm === 'strict')) {
      expect(j.parents).toHaveLength(2);
      const body = JSON.parse(j.body);
      expect(body.card.explanation).toBe(text);
      expect(body).not.toHaveProperty('decision');
      expect(body).not.toHaveProperty('gold');
      expect(body).not.toHaveProperty('arm');
    }
  });
  it('does not schedule reconciliation for invalid/nonfinal source replies or repairs for failed writers', () => {
    const { d, p } = written(),
      sourceJob = coverageJobs(d, p).find((j) => j.stage === 'source' && j.arm === 'strict')!;
    p.calls[sourceJob.key] = receipt(sourceJob, '{}');
    expect(coverageJobs(d, p).some((j) => j.stage === 'reconciliation' && j.arm === 'strict')).toBe(
      false,
    );
    const bad = empty();
    for (const j of knownCoverageJobs(d).filter((j) => j.stage === 'writing'))
      bad.calls[j.key] = receipt(j, candidate(j), 'max_tokens');
    const jobs = coverageJobs(d, bad);
    expect(jobs).toHaveLength(16);
    expect(jobs.every((j) => j.attempt === 0)).toBe(true);
  });
  it('keeps mixed quality blinded and never counts pending reconciliation as a full strict pass', () => {
    const { d, p } = written(),
      jobs = coverageJobs(d, p);
    for (const j of jobs.filter((j) => j.stage === 'quality')) {
      expect(j.body).not.toContain('variants');
      expect(j.body).not.toContain('explanation');
    }
    expect(scoreCoverage(d, p, jobs).writers.every((w) => w.machinePass === false)).toBe(true);
  });
  it('rejects changed source receipts, unbound jobs, unsafe paths and stale preparation', () => {
    const { d, p } = written(),
      w = knownCoverageJobs(d)[0];
    p.calls[w.key].rawSha = hash('changed');
    expect(() => validateCoverageProgress(d, p, hash('design'))).toThrow();
    const unsafe = fixture();
    unsafe.files[0].path = '../elsewhere';
    expect(() => validateCoverageDesign(unsafe)).toThrow();
    const stale = fixture();
    stale.targets[0].plan.packetSha = hash('wrong');
    expect(() => validateCoverageDesign(stale)).toThrow();
  });
  it('keeps default, score-only and zero-limit execution free with poisoned credentials', () => {
    const root = `_scratch/Cassian/coverage-free-${randomUUID()}`;
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
          'scripts/cassian-coverage-probe-calls.ts',
          ...flags,
        ],
        {
          encoding: 'utf8',
          timeout: 15000,
          env: {
            ...process.env,
            CASSIAN_COVERAGE_DESIGN: path,
            CASSIAN_ENV_FILE: 'missing-file',
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
