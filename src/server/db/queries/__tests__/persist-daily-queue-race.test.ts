import { beforeEach, describe, expect, it, vi } from 'vitest';

// B-DAILY-QUEUE-SWAP-01 — the cross-instance correctness boundary. The
// orchestrator's in-process single-flight only coalesces same-instance builds;
// two builds on different serverless instances both reach persistDailyQueue.
// This proves persist is FIRST-WRITER-WINS: a second builder that finds an
// existing (user, queueDate) row leaves it untouched and returns the queue that
// won — it can never overwrite the five the player is already answering. (The
// old setWhere:untouched rule overwrote a served-but-unanswered queue, which is
// exactly how a returning user got a brand-new set after answering question 1.)

// Capture every insert builder call so we can assert the conflict STRATEGY, not
// just the outcome — a regression back to onConflictDoUpdate must fail loudly.
const insertCalls: Array<{
  values: unknown;
  conflict: 'doNothing' | 'doUpdate' | null;
  conflictArg: unknown;
}> = [];

// Staged result of the insert's RETURNING: [row] = this builder won (inserted),
// [] = it lost the race (ON CONFLICT DO NOTHING produced no row).
let returningRows: unknown[] = [];
// What the post-conflict fallback SELECT finds — the queue that actually won.
let existingRow: unknown = null;
const updateSets: unknown[] = [];

function makeInsertChain() {
  const call: (typeof insertCalls)[number] = { values: undefined, conflict: null, conflictArg: undefined };
  insertCalls.push(call);
  const chain = {
    values(v: unknown) {
      call.values = v;
      return chain;
    },
    onConflictDoNothing(arg: unknown) {
      call.conflict = 'doNothing';
      call.conflictArg = arg;
      return chain;
    },
    onConflictDoUpdate(arg: unknown) {
      call.conflict = 'doUpdate';
      call.conflictArg = arg;
      return chain;
    },
    returning() {
      return Promise.resolve(returningRows);
    },
  };
  return chain;
}

function makeSelectChain() {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(existingRow ? [existingRow] : []),
  };
  return chain;
}

const tx = {
  insert: () => makeInsertChain(),
  update: () => ({
    set: (vals: unknown) => ({
      where: () => {
        updateSets.push(vals);
        return Promise.resolve([]);
      },
    }),
  }),
  select: () => makeSelectChain(),
};

vi.mock('@/server/db', () => ({
  db: {
    transaction: (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  },
  dailyQueues: { id: 'id', userId: 'user_id', queueDate: 'queue_date', slots: 'slots' },
  generatedQuestions: { id: 'gq_id' },
  // The rest of daily.ts's table imports — unused on the persist path but
  // referenced at module load.
  dailyPreferences: {},
  declaredInterests: {},
  feedItems: {},
  masteryEvents: {},
  playerMastery: {},
  questions: {},
  skippedDailyQuestions: {},
  userDomainExclusions: {},
  users: {},
}));

vi.mock('@/lib/games/timezone', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  getDailyAssignmentBounds: vi.fn(() => ({
    assignmentDateStr: '2026-06-18',
    assignmentDate: new Date('2026-06-18T00:00:00Z'),
    expiresAt: new Date('2026-06-19T17:00:00Z'),
  })),
}));

import { persistDailyQueue } from '@/server/db/queries/daily';

const USER = 'user-1';
const slotsA = [{ slot_index: 0, source: 'bot', generated_question_id: 'a1', answered: false }] as never;

beforeEach(() => {
  insertCalls.length = 0;
  updateSets.length = 0;
  returningRows = [];
  existingRow = null;
  vi.clearAllMocks();
});

describe('persistDailyQueue — first-writer-wins (B-DAILY-QUEUE-SWAP-01)', () => {
  it('uses ON CONFLICT DO NOTHING keyed on (userId, queueDate) — never DO UPDATE', async () => {
    returningRows = [{ id: 'q', userId: USER, queueDate: '2026-06-18', slots: slotsA }];

    await persistDailyQueue(USER, slotsA, []);

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].conflict).toBe('doNothing');
    // Crucially NOT an overwrite — that's the regression we're guarding against.
    expect(insertCalls[0].conflict).not.toBe('doUpdate');
    expect(insertCalls[0].conflictArg).toEqual({ target: ['user_id', 'queue_date'] });
  });

  it('winner: returns the freshly inserted row and flags its generated questions used', async () => {
    const inserted = { id: 'winner', userId: USER, queueDate: '2026-06-18', slots: slotsA };
    returningRows = [inserted];

    const result = await persistDailyQueue(USER, slotsA, ['a1']);

    expect(result).toBe(inserted);
    // Its generated questions are marked used because they made it into the queue.
    expect(updateSets).toEqual([{ usedInQueue: true }]);
  });

  it('loser: returns the EXISTING winning queue and does NOT flag its discarded questions used', async () => {
    // RETURNING empty = the conflict row already existed (the winner). The loser
    // must hand back that winning queue unchanged...
    returningRows = [];
    existingRow = { id: 'winner', userId: USER, queueDate: '2026-06-18', slots: slotsA };

    const result = await persistDailyQueue(USER, [{ slot_index: 0, generated_question_id: 'b1' }] as never, ['b1']);

    expect(result).toBe(existingRow);
    // ...and must NOT mark its own (discarded) generated questions as used —
    // they never entered the persisted queue.
    expect(updateSets).toEqual([]);
  });
});
