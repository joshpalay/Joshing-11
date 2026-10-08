import { beforeEach, describe, expect, it, vi } from 'vitest';

const listSubmitted = vi.fn();
const markFailed = vi.fn();
vi.mock('@/server/db/queries/verify-batch', () => ({
  listSubmittedVerifyBatchRuns: () => listSubmitted(),
  markVerifyBatchRunFailed: (id: string, now: Date) => markFailed(id, now),
  markVerifyBatchRunHarvested: vi.fn(),
  recordVerifyBatchRun: vi.fn(),
}));
vi.mock('@/server/db/queries/llm-provider-experiment', () => ({ recordLlmUsage: vi.fn() }));

import type Anthropic from '@anthropic-ai/sdk';

import { harvestVerifyBatches } from '@/server/quality/verify-batch';

const NOW = new Date('2026-10-08T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function clientThatThrows(error: unknown): Anthropic {
  return {
    messages: { batches: { retrieve: vi.fn().mockRejectedValue(error), results: vi.fn() } },
  } as unknown as Anthropic;
}

function run(ageDays: number) {
  return { id: 'run-1', providerBatchId: 'msgbatch_x', createdAt: new Date(NOW.getTime() - ageDays * DAY) };
}

describe('harvestVerifyBatches — a run that errors on retrieve', () => {
  beforeEach(() => {
    listSubmitted.mockReset();
    markFailed.mockReset().mockResolvedValue(undefined);
  });

  it('gives up on a 404 immediately so it cannot block new submissions', async () => {
    listSubmitted.mockResolvedValue([run(1)]);
    const summary = await harvestVerifyBatches(clientThatThrows({ status: 404, message: 'not found' }), NOW);
    expect(markFailed).toHaveBeenCalledWith('run-1', NOW);
    expect(summary).toMatchObject({ runsFailed: 1, runsStillProcessing: 0 });
  });

  it('gives up on any error once the run is past the stale cutoff', async () => {
    listSubmitted.mockResolvedValue([run(42)]);
    const summary = await harvestVerifyBatches(clientThatThrows(new Error('socket hang up')), NOW);
    expect(markFailed).toHaveBeenCalledOnce();
    expect(summary).toMatchObject({ runsFailed: 1, runsStillProcessing: 0 });
  });

  it('keeps a young run with a transient error in flight for the next pass', async () => {
    listSubmitted.mockResolvedValue([run(1)]);
    const summary = await harvestVerifyBatches(clientThatThrows({ status: 500, message: 'overloaded' }), NOW);
    expect(markFailed).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ runsFailed: 0, runsStillProcessing: 1 });
  });

  it('stays in flight if recording the give-up fails, rather than silently dropping it', async () => {
    listSubmitted.mockResolvedValue([run(1)]);
    markFailed.mockRejectedValue(new Error('db down'));
    const summary = await harvestVerifyBatches(clientThatThrows({ status: 404 }), NOW);
    expect(summary).toMatchObject({ runsFailed: 0, runsStillProcessing: 1 });
  });
});
