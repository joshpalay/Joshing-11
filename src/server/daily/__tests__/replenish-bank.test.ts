import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  countServeableOwnBankStock: vi.fn(),
  getKnowledgeBase: vi.fn(),
  getDailyPreferences: vi.fn(),
  generateDailyQuestionsFromKnowledgeBase: vi.fn(),
}));

vi.mock('@/server/db/queries/daily', () => ({
  countServeableOwnBankStock: mocks.countServeableOwnBankStock,
  getKnowledgeBase: mocks.getKnowledgeBase,
}));
vi.mock('@/server/db/queries/daily-preferences', () => ({
  getDailyPreferences: mocks.getDailyPreferences,
}));
vi.mock('@/server/daily/generate-questions', () => ({
  generateDailyQuestionsFromKnowledgeBase: mocks.generateDailyQuestionsFromKnowledgeBase,
}));

import { replenishBankAfterPlay, replenishStockTarget } from '@/server/daily/replenish-bank';

const USER = 'user-1';

function setFlag(value: string | undefined) {
  if (value === undefined) delete process.env.DAILY_REPLENISH_ENABLED;
  else process.env.DAILY_REPLENISH_ENABLED = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  setFlag('true');
  delete process.env.DAILY_REPLENISH_STOCK_TARGET;
  mocks.getDailyPreferences.mockResolvedValue({
    domainMode: 'custom',
    selectedDomains: ['Hamlet', 'Star Trek'],
  });
  mocks.getKnowledgeBase.mockResolvedValue([{ domain: 'Hamlet' }, { domain: 'Star Trek' }]);
  mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([]);
});

describe('replenishBankAfterPlay', () => {
  it('no-ops (and never bills) when the flag is off', async () => {
    setFlag(undefined);
    const report = await replenishBankAfterPlay(USER);
    expect(report).toEqual({ ran: false, reason: 'disabled' });
    expect(mocks.countServeableOwnBankStock).not.toHaveBeenCalled();
    expect(mocks.generateDailyQuestionsFromKnowledgeBase).not.toHaveBeenCalled();
  });

  it('does not generate when stock already meets the target', async () => {
    // 4 domains × 2 within-cap rows = 8 effective ≥ target 7.
    mocks.countServeableOwnBankStock.mockResolvedValue(
      new Map([
        ['Hamlet', 2],
        ['Star Trek', 2],
        ['Tudor Dynasty', 2],
        ['New Testament', 2],
      ]),
    );
    const report = await replenishBankAfterPlay(USER);
    expect(report.ran).toBe(false);
    expect(report.reason).toBe('stocked');
    expect(report.stock).toBe(8);
    expect(mocks.generateDailyQuestionsFromKnowledgeBase).not.toHaveBeenCalled();
  });

  it('caps each domain’s contribution at the diversity cap (concentration cannot mask a shortfall)', async () => {
    // 17 raw rows but 8 in one domain → effective 2+2+2+1+1+1+1+1 = 11 with an
    // 8-domain palette… use a small case: 8 Hamlet + 1 Star Trek = effective 3.
    mocks.countServeableOwnBankStock.mockResolvedValue(
      new Map([
        ['Hamlet', 8],
        ['Star Trek', 1],
      ]),
    );
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([]);
    const report = await replenishBankAfterPlay(USER);
    // effective stock 3, target 7 → deficit 4 → generation runs
    expect(report.ran).toBe(true);
    expect(report.stock).toBe(3);
    expect(report.deficit).toBe(4);
    expect(mocks.generateDailyQuestionsFromKnowledgeBase).toHaveBeenCalledWith(USER, 8, {
      firstRun: false,
    });
  });

  it('generates the over-provisioned deficit when stock is short', async () => {
    // effective stock 2 (3 rows capped at 2), default target 7 → deficit 5 → request min(5*2, 10) = 10
    mocks.countServeableOwnBankStock.mockResolvedValue(new Map([['Hamlet', 3]]));
    mocks.generateDailyQuestionsFromKnowledgeBase.mockResolvedValue([{ id: 'q1' }, { id: 'q2' }]);
    const report = await replenishBankAfterPlay(USER);
    expect(mocks.generateDailyQuestionsFromKnowledgeBase).toHaveBeenCalledWith(USER, 10, {
      firstRun: false,
    });
    expect(report).toMatchObject({ ran: true, stock: 2, deficit: 5, generated: 2 });
  });

  it('counts stock against the CUSTOM palette, not the whole knowledge base', async () => {
    mocks.countServeableOwnBankStock.mockResolvedValue(new Map());
    await replenishBankAfterPlay(USER);
    expect(mocks.countServeableOwnBankStock).toHaveBeenCalledWith(USER, ['Hamlet', 'Star Trek']);
    expect(mocks.getKnowledgeBase).toHaveBeenCalled(); // fetched in parallel, unused in custom mode
  });

  it('falls back to the knowledge base as palette in random mode', async () => {
    mocks.getDailyPreferences.mockResolvedValue({ domainMode: 'random', selectedDomains: [] });
    mocks.countServeableOwnBankStock.mockResolvedValue(new Map());
    await replenishBankAfterPlay(USER);
    expect(mocks.countServeableOwnBankStock).toHaveBeenCalledWith(USER, ['Hamlet', 'Star Trek']);
  });

  it('fails open on any error (background optimization must never surface)', async () => {
    mocks.countServeableOwnBankStock.mockRejectedValue(new Error('db down'));
    const report = await replenishBankAfterPlay(USER);
    expect(report).toEqual({ ran: false, reason: 'error' });
  });

  it('honors the env stock target', async () => {
    process.env.DAILY_REPLENISH_STOCK_TARGET = '10';
    expect(replenishStockTarget()).toBe(10);
    // effective stock 9 (4×2 + 1, all within the cap) < 10 → deficit 1 → request 2
    mocks.countServeableOwnBankStock.mockResolvedValue(
      new Map([
        ['Hamlet', 2],
        ['Star Trek', 2],
        ['Tudor Dynasty', 2],
        ['New Testament', 2],
        ['UX Design', 1],
      ]),
    );
    await replenishBankAfterPlay(USER);
    expect(mocks.generateDailyQuestionsFromKnowledgeBase).toHaveBeenCalledWith(USER, 2, {
      firstRun: false,
    });
  });
});
