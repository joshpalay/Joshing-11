import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getQueueMock, alreadyProposedMock, upsertMock, proposeMock, verifyMock } = vi.hoisted(
  () => ({
    getQueueMock: vi.fn(async (): Promise<unknown[]> => []),
    alreadyProposedMock: vi.fn(async () => new Set<string>()),
    upsertMock: vi.fn(async () => undefined),
    proposeMock: vi.fn(
      async (): Promise<{
        kind: string;
        proposedStem: string | null;
        proposedExplanation: string | null;
        note: string;
      }> => ({
        kind: 'extra_fact_explainer',
        proposedStem: null,
        proposedExplanation: 'trimmed explainer',
        note: 'removed the wrong co-founder claim',
      }),
    ),
    verifyMock: vi.fn(
      async (): Promise<{ outcome: string; reason: string } | null> => ({
        outcome: 'ok',
        reason: 'checks out',
      }),
    ),
  }),
);

vi.mock('@/server/db/queries/machine-demotions', () => ({
  getMachineDemotionsForReview: getQueueMock,
}));
vi.mock('@/server/db/queries/salvage-proposals', () => ({
  questionIdsWithProposal: alreadyProposedMock,
  upsertSalvageProposal: upsertMock,
}));
vi.mock('@/server/quality/salvage-question', () => ({ proposeSalvage: proposeMock }));
vi.mock('@/server/quality/verify-question', () => ({ verifyQuestion: verifyMock }));

import {
  isSalvageOnDemoteEnabled,
  runSalvageSweep,
  type SalvageSweepItem,
} from '@/server/quality/salvage-sweep';

function item(id: string): SalvageSweepItem {
  return {
    questionId: id,
    questionText: `Question ${id}?`,
    correctAnswer: 'The answer',
    explanation: 'An explainer with one extra fact.',
    verificationReason: 'extra_fact error: the explainer smuggles a wrong claim',
    canonicalSubcategory: 'Detroit Techno',
    broadCategory: 'Music',
  };
}

beforeEach(() => {
  // Tests override with persistent mockResolvedValue, so a full reset +
  // re-seeded defaults keeps them from leaking into the next test.
  vi.resetAllMocks();
  getQueueMock.mockResolvedValue([]);
  alreadyProposedMock.mockResolvedValue(new Set());
  upsertMock.mockResolvedValue(undefined);
  proposeMock.mockResolvedValue({
    kind: 'extra_fact_explainer',
    proposedStem: null,
    proposedExplanation: 'trimmed explainer',
    note: 'removed the wrong co-founder claim',
  });
  verifyMock.mockResolvedValue({ outcome: 'ok', reason: 'checks out' });
});

describe('runSalvageSweep', () => {
  it('proposes, re-verifies, and persists ready proposals for un-proposed demotions', async () => {
    getQueueMock.mockResolvedValue([item('q1'), item('q2')]);
    alreadyProposedMock.mockResolvedValue(new Set(['q1']));

    const summary = await runSalvageSweep({ persist: true });

    expect(summary).toEqual({
      queued: 2,
      alreadyProposed: 1,
      processed: 1,
      ready: 1,
      reverifyFailed: 0,
      unsalvageable: 0,
      errors: 0,
    });
    expect(proposeMock).toHaveBeenCalledTimes(1);
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'q2', status: 'ready', reverifyOutcome: 'ok' }),
    );
  });

  it('re-verifies the PROPOSED text against the EXISTING answer', async () => {
    getQueueMock.mockResolvedValue([item('q1')]);
    proposeMock.mockResolvedValue({
      kind: 'extra_fact_stem',
      proposedStem: 'Trimmed question?',
      proposedExplanation: null,
      note: 'removed decorative year',
    });

    await runSalvageSweep({ persist: true });

    expect(verifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        questionText: 'Trimmed question?',
        answer: 'The answer',
        explanation: 'An explainer with one extra fact.',
        dimensions: ['false_premise', 'extra_fact'],
      }),
    );
  });

  it('stores an unsalvageable proposal without calling the verifier', async () => {
    getQueueMock.mockResolvedValue([item('q1')]);
    proposeMock.mockResolvedValue({
      kind: 'unsalvageable',
      proposedStem: null,
      proposedExplanation: null,
      note: 'the answer itself is wrong',
    });

    const summary = await runSalvageSweep({ persist: true });

    expect(summary.unsalvageable).toBe(1);
    expect(verifyMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'q1', kind: 'unsalvageable', status: 'unsalvageable' }),
    );
  });

  it('stores a failed re-verify as unsalvageable (never shows an unproven fix)', async () => {
    getQueueMock.mockResolvedValue([item('q1')]);
    verifyMock.mockResolvedValue({ outcome: 'demoted', reason: 'still wrong' });

    const summary = await runSalvageSweep({ persist: true });

    expect(summary.reverifyFailed).toBe(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'q1', status: 'unsalvageable', reverifyOutcome: 'demoted' }),
    );
  });

  it('persists nothing in dry-run mode', async () => {
    getQueueMock.mockResolvedValue([item('q1')]);

    await runSalvageSweep({ persist: false });

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('caps processed items at the limit', async () => {
    getQueueMock.mockResolvedValue([item('q1'), item('q2'), item('q3')]);

    const summary = await runSalvageSweep({ persist: true, limit: 2 });

    expect(summary.processed).toBe(2);
    expect(proposeMock).toHaveBeenCalledTimes(2);
  });

  it('contains an item fault (counted as error, nothing persisted, sweep continues)', async () => {
    getQueueMock.mockResolvedValue([item('q1'), item('q2')]);
    proposeMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        kind: 'extra_fact_explainer',
        proposedStem: null,
        proposedExplanation: 'trimmed',
        note: 'ok',
      });

    const summary = await runSalvageSweep({ persist: true, concurrency: 1 });

    expect(summary.errors).toBe(1);
    expect(summary.ready).toBe(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ questionId: 'q2' }));
  });
});

describe('isSalvageOnDemoteEnabled', () => {
  const prior = process.env.SALVAGE_ON_DEMOTE_ENABLED;
  afterEach(() => {
    if (prior === undefined) delete process.env.SALVAGE_ON_DEMOTE_ENABLED;
    else process.env.SALVAGE_ON_DEMOTE_ENABLED = prior;
  });

  it('defaults ON', () => {
    delete process.env.SALVAGE_ON_DEMOTE_ENABLED;
    expect(isSalvageOnDemoteEnabled()).toBe(true);
  });

  it('turns off only on an explicit false-y value', () => {
    process.env.SALVAGE_ON_DEMOTE_ENABLED = 'false';
    expect(isSalvageOnDemoteEnabled()).toBe(false);
    process.env.SALVAGE_ON_DEMOTE_ENABLED = 'off';
    expect(isSalvageOnDemoteEnabled()).toBe(false);
    process.env.SALVAGE_ON_DEMOTE_ENABLED = 'true';
    expect(isSalvageOnDemoteEnabled()).toBe(true);
  });
});
