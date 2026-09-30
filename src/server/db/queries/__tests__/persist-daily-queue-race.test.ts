import { beforeEach, describe, expect, it, vi } from 'vitest';

// B-DAILY-QUEUE-SWAP-01 — the cross-instance correctness boundary. The
// orchestrator's in-process single-flight only coalesces same-instance builds;
// two builds on different serverless instances both reach persistDailyQueue.
// This proves persist is FIRST-WRITER-WINS: a second builder that finds an
// existing (user, queueDate) row leaves it untouched and returns the queue that
// won — it can never overwrite the five the player is already answering. (The
// old setWhere:untouched rule overwrote a served-but-unanswered queue, which is
// exactly how a returning user got a brand-new set after answering question 1.)
// The one exception is a row with NO slots (QA 2026-09-29, C1): nothing there
// can be in play, and leaving it stranded the player for the day. The real
// SQL behaviour is covered in daily/__tests__/empty-round-recovery.pg.test.ts.

// Capture every insert builder call so we can assert the conflict STRATEGY, not
// just the outcome — an UNFENCED overwrite must fail loudly.
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
  it('conflicts on (userId, queueDate) and only overwrites a row with no slots', async () => {
    returningRows = [{ id: 'q', userId: USER, queueDate: '2026-06-18', slots: slotsA }];

    await persistDailyQueue(USER, slotsA, []);

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].conflict).toBe('doUpdate');
    const arg = insertCalls[0].conflictArg as { target: unknown; set: object; setWhere?: unknown };
    expect(arg.target).toEqual(['user_id', 'queue_date']);
    expect(Object.keys(arg.set).sort()).toEqual(['slots', 'targetSize']);
    // Crucially FENCED — an update without this guard is the served-queue
    // overwrite regression.
    expect(JSON.stringify(arg.setWhere)).toContain('jsonb_array_length');
    expect(JSON.stringify(arg.setWhere)).toContain('= 0');
  });

  it('winner: returns { row, won: true } and flags its generated questions used', async () => {
    const inserted = { id: 'winner', userId: USER, queueDate: '2026-06-18', slots: slotsA };
    returningRows = [inserted];

    const result = await persistDailyQueue(USER, slotsA, ['a1']);

    expect(result?.row).toBe(inserted);
    // `won` is the signal a caller MUST check before doing anything further
    // with its own `slots` array or a position derived from it (see the
    // PersistDailyQueueResult doc comment) — confirmed missing in production,
    // diagnosis/daily-build-latency-deferral-plan.md open question 5.
    expect(result?.won).toBe(true);
    // Its generated questions are marked used because they made it into the queue.
    expect(updateSets).toEqual([{ usedInQueue: true }]);
  });

  it('loser: returns { row: winner, won: false } and does NOT flag its discarded questions used', async () => {
    // RETURNING empty = the conflict row already existed (the winner). The loser
    // must hand back that winning queue unchanged...
    returningRows = [];
    existingRow = { id: 'winner', userId: USER, queueDate: '2026-06-18', slots: slotsA };

    const result = await persistDailyQueue(USER, [{ slot_index: 0, generated_question_id: 'b1' }] as never, ['b1']);

    expect(result?.row).toBe(existingRow);
    expect(result?.won).toBe(false);
    // ...and must NOT mark its own (discarded) generated questions as used —
    // they never entered the persisted queue.
    expect(updateSets).toEqual([]);
  });
});
