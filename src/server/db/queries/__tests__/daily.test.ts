import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stage select results per call within one function invocation:
//   index 0 = the today fetch, index 1 = the prior fetch (carry-forward only).
let selectResults: unknown[][] = [[], []];
let selectCall = 0;
const deleteWheres: unknown[] = [];
const updateSets: unknown[] = [];

const makeChain = () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => {
      const r = selectResults[Math.min(selectCall, selectResults.length - 1)] ?? [];
      selectCall += 1;
      return Promise.resolve(r);
    },
  };
  return chain;
};

vi.mock('@/server/db', () => ({
  db: {
    select: () => makeChain(),
    delete: () => ({
      where: (cond: unknown) => {
        deleteWheres.push(cond);
        return Promise.resolve([]);
      },
    }),
    update: () => ({
      set: (vals: unknown) => ({
        where: () => {
          updateSets.push(vals);
          return Promise.resolve([]);
        },
      }),
    }),
  },
  dailyQueues: { id: 'id', userId: 'user_id', queueDate: 'queue_date' },
  generatedQuestions: {},
  dailyPreferences: {},
  declaredInterests: {},
  feedItems: {},
  masteryEvents: {},
  playerMastery: {},
  questions: {},
  userDomainExclusions: {},
  users: {},
}));

vi.mock('@/lib/games/timezone', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  getDailyAssignmentBounds: vi.fn(() => ({
    assignmentDateStr: '2026-05-31',
    assignmentDate: new Date('2026-05-31T00:00:00Z'),
    expiresAt: new Date('2026-06-01T12:00:00Z'),
  })),
}));

import {
  clearStaleShortTodayQueue,
  carryForwardUntouchedDailyQueue,
} from '@/server/db/queries/daily';

const slots = (n: number, opts: { answered?: boolean; skipped?: boolean } = {}) =>
  Array.from({ length: n }, (_, i) => ({
    slot_index: i,
    domain: `Domain ${i}`,
    answered: opts.answered ?? false,
    skipped: opts.skipped ?? false,
  }));

const BEFORE_WINDOW = new Date('2026-05-29T12:00:00Z'); // before today's assignmentDate
const IN_WINDOW = new Date('2026-05-31T12:00:00Z'); // at/after today's assignmentDate

beforeEach(() => {
  selectResults = [[], []];
  selectCall = 0;
  deleteWheres.length = 0;
  updateSets.length = 0;
});

describe('clearStaleShortTodayQueue', () => {
  it('clears a short, untouched queue carried over from a prior day', async () => {
    selectResults = [[{ id: 'stale', slots: slots(3), createdAt: BEFORE_WINDOW }], []];
    expect(await clearStaleShortTodayQueue('u1')).toBe(true);
    expect(deleteWheres).toHaveLength(1);
  });

  it('keeps a full queue', async () => {
    selectResults = [[{ id: 'full', slots: slots(5), createdAt: BEFORE_WINDOW }], []];
    expect(await clearStaleShortTodayQueue('u1')).toBe(false);
    expect(deleteWheres).toHaveLength(0);
  });

  it('keeps a started (answered) short queue', async () => {
    selectResults = [[{ id: 'started', slots: slots(3, { answered: true }), createdAt: BEFORE_WINDOW }], []];
    expect(await clearStaleShortTodayQueue('u1')).toBe(false);
    expect(deleteWheres).toHaveLength(0);
  });

  it('keeps a short queue that was built today (avoids a per-load re-bill loop)', async () => {
    selectResults = [[{ id: 'today', slots: slots(3), createdAt: IN_WINDOW }], []];
    expect(await clearStaleShortTodayQueue('u1')).toBe(false);
    expect(deleteWheres).toHaveLength(0);
  });

  it('returns false when there is no queue today', async () => {
    selectResults = [[], []];
    expect(await clearStaleShortTodayQueue('u1')).toBe(false);
  });
});

describe('carryForwardUntouchedDailyQueue', () => {
  it('does NOT carry a short prior queue forward (lets it regenerate)', async () => {
    selectResults = [[], [{ id: 'p1', slots: slots(3), createdAt: BEFORE_WINDOW }]];
    expect(await carryForwardUntouchedDailyQueue('u1')).toBe(false);
    expect(updateSets).toHaveLength(0);
  });

  it('carries a full untouched prior queue forward', async () => {
    selectResults = [[], [{ id: 'p1', slots: slots(5), createdAt: BEFORE_WINDOW }]];
    expect(await carryForwardUntouchedDailyQueue('u1')).toBe(true);
    expect(updateSets).toHaveLength(1);
  });

  it('does NOT carry a started prior queue forward', async () => {
    selectResults = [[], [{ id: 'p1', slots: slots(5, { answered: true }), createdAt: BEFORE_WINDOW }]];
    expect(await carryForwardUntouchedDailyQueue('u1')).toBe(false);
    expect(updateSets).toHaveLength(0);
  });
});
