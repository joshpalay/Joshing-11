import { beforeEach, describe, expect, it, vi } from 'vitest';

const { inserts, poolQuery, harvestMock, mayMock, submitMock, yieldMock, liveCall, parseMock } = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  poolQuery: vi.fn(),
  harvestMock: vi.fn(),
  mayMock: vi.fn(),
  submitMock: vi.fn(),
  yieldMock: vi.fn(),
  liveCall: vi.fn(),
  parseMock: vi.fn(),
}));

vi.mock('@/lib/llm', () => ({
  ANTHROPIC_MODEL: 'claude-sonnet-5-5',
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',
  extractTextContent: (content: Array<{ text: string }>) => content.map((c) => c.text).join(''),
  getAnthropicClient: () => ({}),
  loggedMessagesCreate: (...args: unknown[]) => liveCall(...args),
}));
vi.mock('@/server/db', () => ({
  pool: { query: (sql: string, params?: unknown[]) => poolQuery(sql, params) },
  generatedQuestions: {},
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => { inserts.push(v); return [{ id: `row-${inserts.length}`, questionText: v.questionText, answer: v.answer, subjectEntity: null }]; },
      }),
    }),
  },
}));
vi.mock('@/server/daily/generate-questions', () => ({
  SYSTEM_PROMPT: 'SYSTEM',
  buildUserPrompt: (labels: string[], count: number) => `make ${count} about ${labels[0]}`,
  parseQuestions: (text: string) => parseMock(text),
  findQualityFailures: async () => ({ toDrop: new Set<number>() }),
  findFactualFailures: async () => ({ toDrop: new Set<number>() }),
  findAnswerLeaks: () => ({ toDrop: new Set<number>() }),
}));
vi.mock('@/server/daily/domain-reference', () => ({ getReferencePassagesForDomains: async () => undefined }));
vi.mock('@/server/db/queries/domain-depth-estimate', () => ({
  coCalibrateLoweredEstimates: vi.fn(),
  getReferenceRoutingHints: async () => new Map(),
  recordSupplyYieldObservation: (o: unknown) => yieldMock(o),
}));
vi.mock('@/server/daily/types', () => ({ resolveDailyBasePoints: () => 10 }));
vi.mock('@/server/daily/ask-to-answer', () => ({ resolveMachineTrustTier: () => 'machine' }));
vi.mock('@/server/knowledge/graph', () => ({ resolveFinestNode: async (label: string) => label }));
vi.mock('@/server/daily/supply-state', () => ({ dryRoundsThreshold: () => 3, nearCompleteRatio: () => 0.9 }));
vi.mock('@/server/pool/dedup', () => ({ embedAndResolveDuplicatesBatch: vi.fn() }));
vi.mock('@/server/llm/cron-batch', () => ({
  harvestCronBatches: (...args: unknown[]) => harvestMock(...args),
  mayCronBatchSubmit: (...args: unknown[]) => mayMock(...args),
  submitCronBatch: (...args: unknown[]) => submitMock(...args),
}));

import { domainKey } from '@/lib/knowledge/domain-key';
import { runSupplyBackfill, type BackfillPlan } from '@/server/daily/supply-backfill';

const HAMLET = domainKey('Hamlet');
const idle = { runsChecked: 0, runsHarvested: 0, runsStillProcessing: 0, runsFailed: 0, resultFailures: 0 };
const q = (fact: string) => ({
  question_text: `Q ${fact}`, answer: 'A', explainer: 'E', difficulty_estimate: 2, fact_key: fact, subject_entity: null,
  sub_angles: [], acceptable_variants: [], canonical_subcategory: 'Hamlet', broad_category: 'Literature',
});
const plan: BackfillPlan = { domainKey: HAMLET, label: 'Hamlet', interested: 1, have: 0, cap: 100, bufferTarget: 14, batch: 17, ground: false, skipReason: null, estCostUsd: 0.05 };

function dbWith(opts: { dryDomain: boolean; bankFactKeys?: string[] }) {
  poolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('"DeclaredInterest"')) return { rows: opts.dryDomain ? [{ userId: 'u1', domain: 'Hamlet' }] : [] };
    if (sql.includes('consecutive_dry_rounds')) {
      return { rows: opts.dryDomain ? [{ domain_key: HAMLET, sample_label: 'Hamlet', fandom_host: null, effective_est: 100, have: 0, own_max: 0, consecutive_dry_rounds: 5 }] : [] };
    }
    if (sql.includes('question_text, fact_key')) return { rows: (opts.bankFactKeys ?? []).map((f) => ({ question_text: 'old', fact_key: f, sub_angles: [] })) };
    return { rows: [] };
  });
}

describe('runSupplyBackfill — batch mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserts.length = 0;
    submitMock.mockResolvedValue({ providerBatchId: 'msgbatch_b', requestCount: 1 });
  });

  it('submits tonight\'s selection as one batch with the plan in the payload, and makes no live call', async () => {
    dbWith({ dryDomain: true });
    harvestMock.mockResolvedValue(idle);
    mayMock.mockResolvedValue(true);
    const report = await runSupplyBackfill({ dryRun: false, limit: 3, systemUserId: 'sys', batch: true });
    expect(liveCall).not.toHaveBeenCalled();
    const [, kind, requests, payload] = submitMock.mock.calls[0];
    expect(kind).toBe('backfill');
    expect(requests).toHaveLength(1);
    expect(requests[0].custom_id).toBe('b_0');
    expect(requests[0].params).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 6000, temperature: 0.8 });
    expect(payload.plans.b_0).toMatchObject({ domainKey: HAMLET, label: 'Hamlet' });
    expect(report.batch?.submitted).toEqual({ providerBatchId: 'msgbatch_b', requestCount: 1 });
    expect(inserts).toHaveLength(0);
  });

  it('harvest gates, novelty-checks against the bank as it is now, persists, and records yield', async () => {
    dbWith({ dryDomain: false, bankFactKeys: ['already-banked'] });
    parseMock.mockReturnValue([q('fresh-one'), q('already-banked'), q('fresh-two')]);
    harvestMock.mockImplementation(async (_c, kind, scope, _n, onResult) => {
      expect([kind, scope]).toEqual(['backfill', 'backfill-supply-generate']);
      await onResult('b_0', { content: [{ type: 'text', text: '[...]' }] }, { payload: { plans: { b_0: plan } } });
      return { ...idle, runsHarvested: 1 };
    });
    const report = await runSupplyBackfill({ dryRun: false, limit: 0, systemUserId: 'sys', batch: true, batchSubmit: false });
    expect(inserts.map((i) => i.factKey)).toEqual(['fresh-one', 'fresh-two']);
    expect(report.built).toEqual([{ label: 'Hamlet', generated: 3, persisted: 2 }]);
    expect(yieldMock).toHaveBeenCalledWith(expect.objectContaining({ yieldedDomainKeys: expect.arrayContaining([HAMLET]) }));
    expect(submitMock).not.toHaveBeenCalled();
    expect(report.batch?.submitSkippedReason).toBe('harvest-only pass');
  });

  it('a failed result persists nothing and records no yield (outage, not evidence)', async () => {
    dbWith({ dryDomain: false });
    harvestMock.mockImplementation(async (_c, _k, _s, _n, onResult) => {
      await onResult('b_0', null, { payload: { plans: { b_0: plan } } });
      return idle;
    });
    const report = await runSupplyBackfill({ dryRun: false, limit: 0, systemUserId: 'sys', batch: true, batchSubmit: false });
    expect(inserts).toHaveLength(0);
    expect(yieldMock).not.toHaveBeenCalled();
    expect(report.built).toEqual([]);
  });

  it('does not resubmit while yesterday\'s batch is in flight', async () => {
    dbWith({ dryDomain: true });
    harvestMock.mockResolvedValue({ ...idle, runsStillProcessing: 1 });
    mayMock.mockResolvedValue(false);
    const report = await runSupplyBackfill({ dryRun: false, limit: 3, systemUserId: 'sys', batch: true });
    expect(submitMock).not.toHaveBeenCalled();
    expect(report.batch?.submitSkippedReason).toBe('batch still in flight');
  });

  it('dry-run never harvests or submits', async () => {
    dbWith({ dryDomain: true });
    await runSupplyBackfill({ dryRun: true, limit: 3, systemUserId: 'sys', batch: true });
    expect(harvestMock).not.toHaveBeenCalled();
    expect(submitMock).not.toHaveBeenCalled();
  });
});
