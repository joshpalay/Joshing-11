import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, dbMock, harvestMock, mayMock, submitMock } = vi.hoisted(() => {
  const state = {
    pendingRows: [] as Array<Record<string, unknown>>,
    updates: [] as Array<{ set: Record<string, unknown>; where: unknown }>,
    updateReturns: [{ id: 'q1' }] as Array<{ id: string }>,
  };
  const dbMock = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => state.pendingRows) })) })) })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn((where: unknown) => {
          state.updates.push({ set: values, where });
          return { returning: vi.fn(async () => state.updateReturns) };
        }),
      })),
    })),
  };
  return { state, dbMock, harvestMock: vi.fn(), mayMock: vi.fn(), submitMock: vi.fn() };
});

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  isNull: vi.fn((column) => ({ op: 'isNull', column })),
  ne: vi.fn((column, value) => ({ op: 'ne', column, value })),
}));
vi.mock('@/server/db', () => ({
  db: dbMock,
  questions: new Proxy({}, { get: (_t, key) => `questions.${String(key)}` }),
}));
vi.mock('@/lib/llm', async () => {
  const actual = await vi.importActual<typeof import('@/lib/llm')>('@/lib/llm');
  return { ...actual, getAnthropicClient: () => ({}) };
});
vi.mock('@/server/llm/cron-batch', () => ({
  isFlagOn: () => true,
  harvestCronBatches: (...args: unknown[]) => harvestMock(...args),
  mayCronBatchSubmit: (...args: unknown[]) => mayMock(...args),
  submitCronBatch: (...args: unknown[]) => submitMock(...args),
}));

import { runVetBatchSweep } from '@/server/llm/vet-batch';

const idle = { runsChecked: 1, runsHarvested: 1, runsStillProcessing: 0, runsFailed: 0, resultFailures: 0 };
const reply = (obj: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
const SAFETY_FAIL = { factual: 'pass', quality: 0.9, safety: 'fail', answer_leaked: false, overall_score: 0.1, reason: 'slur' };
const APPROVE = { factual: 'pass', quality: 0.9, safety: 'pass', answer_leaked: false, overall_score: 0.9, reason: 'good' };
const NOW = new Date('2026-10-16T07:00:00Z');

describe('runVetBatchSweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.pendingRows = [];
    state.updates = [];
    state.updateReturns = [{ id: 'q1' }];
    submitMock.mockResolvedValue({ providerBatchId: 'msgbatch_1', requestCount: 1 });
  });

  it('applies a harvested safety-fail as a hard block, guarded on the row still awaiting a vet', async () => {
    harvestMock.mockImplementation(async (_c, kind, scope, _now, onResult) => {
      expect([kind, scope]).toEqual(['vet', 'vet-question']);
      await onResult('v_q1', reply(SAFETY_FAIL), { payload: {} });
      return idle;
    });
    mayMock.mockResolvedValue(false);
    const report = await runVetBatchSweep(NOW);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].set).toMatchObject({ publicStatus: 'rejected', visibility: 'blocked' });
    const where = JSON.stringify(state.updates[0].where);
    expect(where).toContain('"column":"questions.id","value":"q1"');
    expect(where).toContain('"column":"questions.publicStatus","value":"not_scored"');
    expect(where).toContain('"op":"ne","column":"questions.visibility","value":"blocked"');
    expect(where).toContain('"op":"isNull","column":"questions.deletedAt"');
    expect(report.harvest?.applied.rejected).toBe(1);
  });

  it('counts a row that changed since submit as skipped, not applied', async () => {
    state.updateReturns = [];
    harvestMock.mockImplementation(async (_c, _k, _s, _n, onResult) => { await onResult('v_q1', reply(APPROVE), { payload: {} }); return idle; });
    mayMock.mockResolvedValue(false);
    const report = await runVetBatchSweep(NOW);
    expect(report.harvest?.applied).toMatchObject({ approved: 0, skipped: 1 });
  });

  it('writes nothing for a failed result', async () => {
    harvestMock.mockImplementation(async (_c, _k, _s, _n, onResult) => { await onResult('v_q1', null, { payload: {} }); return idle; });
    mayMock.mockResolvedValue(false);
    await runVetBatchSweep(NOW);
    expect(state.updates).toHaveLength(0);
  });

  it('submits the pending rows with the exact sync request and v_ custom ids', async () => {
    harvestMock.mockResolvedValue(idle);
    mayMock.mockResolvedValue(true);
    state.pendingRows = [{ id: 'q9', questionText: 'Capital of France?', answerText: 'Paris', acceptedAlternatives: null, factualExplanation: null, broadCategory: null, canonicalSubcategory: null }];
    const report = await runVetBatchSweep(NOW);
    const [, kind, requests] = submitMock.mock.calls[0];
    expect(kind).toBe('vet');
    expect(requests[0].custom_id).toBe('v_q9');
    expect(requests[0].params).toMatchObject({ max_tokens: 400, temperature: 0 });
    expect(report.submit).toMatchObject({ scanned: 1, batch: { providerBatchId: 'msgbatch_1' } });
  });

  it('the harvest-only pass never submits', async () => {
    harvestMock.mockResolvedValue(idle);
    mayMock.mockResolvedValue(true);
    state.pendingRows = [{ id: 'q9', questionText: 'x', answerText: 'y' }];
    const report = await runVetBatchSweep(NOW, { submit: false });
    expect(submitMock).not.toHaveBeenCalled();
    expect(report.submit?.skippedReason).toBe('harvest-only pass');
  });
});
