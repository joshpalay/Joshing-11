import { beforeEach, describe, expect, it, vi } from 'vitest';

const listSubmitted = vi.fn();
const latest = vi.fn();
const mark = vi.fn();
const record = vi.fn();
vi.mock('@/server/db/queries/cron-batch', () => ({
  listSubmittedCronBatchRuns: (kind: string) => listSubmitted(kind),
  latestCronBatchSubmittedAt: (kind: string) => latest(kind),
  markCronBatchRun: (id: string, status: string, now: Date) => mark(id, status, now),
  recordCronBatchRun: (...args: unknown[]) => record(...args),
}));
const recordLlmUsage = vi.fn();
vi.mock('@/server/db/queries/llm-provider-experiment', () => ({ recordLlmUsage: (e: unknown) => recordLlmUsage(e) }));

import type Anthropic from '@anthropic-ai/sdk';

import { harvestCronBatches, mayCronBatchSubmit, submitCronBatch } from '@/server/llm/cron-batch';

const NOW = new Date('2026-10-16T08:30:00Z');
const HOUR = 60 * 60 * 1000;
const run = (ageHours: number) => ({ id: 'run-1', providerBatchId: 'msgbatch_x', requestCount: 2, payload: { k: 1 }, createdAt: new Date(NOW.getTime() - ageHours * HOUR) });
const message = { model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 800, output_tokens: 90 } };

function client(opts: { status?: string; results?: unknown[]; retrieveError?: unknown } = {}) {
  return {
    messages: {
      batches: {
        create: vi.fn().mockResolvedValue({ id: 'msgbatch_new' }),
        retrieve: opts.retrieveError
          ? vi.fn().mockRejectedValue(opts.retrieveError)
          : vi.fn().mockResolvedValue({ processing_status: opts.status ?? 'ended' }),
        results: vi.fn().mockImplementation(async () => (async function* () { yield* opts.results ?? []; })()),
      },
    },
  } as unknown as Anthropic;
}

describe('harvestCronBatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mark.mockResolvedValue(undefined);
  });

  it('hands succeeded messages and failed results to the handler, ledgers batch usage, marks harvested', async () => {
    listSubmitted.mockResolvedValue([run(1)]);
    const seen: Array<[string, unknown]> = [];
    const summary = await harvestCronBatches(
      client({ results: [
        { custom_id: 'v_a', result: { type: 'succeeded', message } },
        { custom_id: 'v_b', result: { type: 'expired' } },
      ] }),
      'vet', 'vet-question', NOW,
      async (id, msg, r) => { seen.push([id, msg]); expect(r.payload).toEqual({ k: 1 }); },
    );
    expect(listSubmitted).toHaveBeenCalledWith('vet');
    expect(seen).toEqual([['v_a', message], ['v_b', null]]);
    expect(recordLlmUsage).toHaveBeenCalledOnce();
    expect(recordLlmUsage.mock.calls[0][0]).toMatchObject({ scope: 'vet-question', isBatch: true, inputTokens: 800, outputTokens: 90 });
    expect(mark).toHaveBeenCalledWith('run-1', 'harvested', NOW);
    expect(summary).toMatchObject({ runsHarvested: 1, resultFailures: 1, runsStillProcessing: 0 });
  });

  it('keeps going when one handler throws, and still marks the run harvested', async () => {
    listSubmitted.mockResolvedValue([run(1)]);
    const handler = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
    const summary = await harvestCronBatches(
      client({ results: [
        { custom_id: 'v_a', result: { type: 'succeeded', message } },
        { custom_id: 'v_b', result: { type: 'succeeded', message } },
      ] }),
      'vet', 'vet-question', NOW, handler,
    );
    expect(handler).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ runsHarvested: 1, resultFailures: 1 });
  });

  it('leaves a young in-progress batch in flight and touches nothing', async () => {
    listSubmitted.mockResolvedValue([run(1)]);
    const handler = vi.fn();
    const summary = await harvestCronBatches(client({ status: 'in_progress' }), 'vet', 'vet-question', NOW, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
    expect(summary.runsStillProcessing).toBe(1);
  });

  it('gives up on a 404 so it cannot block submissions forever', async () => {
    listSubmitted.mockResolvedValue([run(1)]);
    const summary = await harvestCronBatches(client({ retrieveError: { status: 404 } }), 'vet', 'vet-question', NOW, vi.fn());
    expect(mark).toHaveBeenCalledWith('run-1', 'failed', NOW);
    expect(summary).toMatchObject({ runsFailed: 1, runsStillProcessing: 0 });
  });

  it('keeps a young run with a transient error in flight', async () => {
    listSubmitted.mockResolvedValue([run(1)]);
    const summary = await harvestCronBatches(client({ retrieveError: { status: 529 } }), 'vet', 'vet-question', NOW, vi.fn());
    expect(mark).not.toHaveBeenCalled();
    expect(summary.runsStillProcessing).toBe(1);
  });
});

describe('mayCronBatchSubmit — at most one submission a day', () => {
  const idle = { runsChecked: 0, runsHarvested: 0, runsStillProcessing: 0, runsFailed: 0, resultFailures: 0 };
  beforeEach(() => vi.clearAllMocks());

  it('allows the first ever submission', async () => {
    latest.mockResolvedValue(null);
    expect(await mayCronBatchSubmit('vet', idle, NOW)).toBe(true);
  });
  it('blocks a resubmit 1.5h after the morning submission', async () => {
    latest.mockResolvedValue(new Date(NOW.getTime() - 1.5 * HOUR));
    expect(await mayCronBatchSubmit('vet', idle, NOW)).toBe(false);
  });
  it('allows the next morning', async () => {
    latest.mockResolvedValue(new Date(NOW.getTime() - 24 * HOUR));
    expect(await mayCronBatchSubmit('vet', idle, NOW)).toBe(true);
  });
  it('blocks while a batch is still in flight', async () => {
    latest.mockResolvedValue(null);
    expect(await mayCronBatchSubmit('vet', { ...idle, runsStillProcessing: 1 }, NOW)).toBe(false);
  });
});

describe('submitCronBatch', () => {
  it('records the run (kind, id, count, payload) after creating the batch', async () => {
    record.mockResolvedValue(undefined);
    const c = client();
    const out = await submitCronBatch(c, 'backfill', [{ custom_id: 'b_0', params: { model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [] } }], { plans: {} });
    expect(out).toEqual({ providerBatchId: 'msgbatch_new', requestCount: 1 });
    expect(record).toHaveBeenCalledWith('backfill', 'msgbatch_new', 1, { plans: {} });
    const created = (c.messages.batches.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(created.requests[0].custom_id).toBe('b_0');
  });
});
