import { beforeEach, describe, expect, it, vi } from 'vitest';

// Chainable db mock: each db.select() resolves to the next queued row set (in
// call order — 1st = inviter mastery rows, 2nd = existing feed rows), and
// db.insert(...).values(rows) records the inserted rows.
const { dbMock, state } = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    inserted: [] as Array<Record<string, unknown>>,
  };

  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'groupBy']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(rows);
    return chain;
  }

  const dbMock = {
    select: vi.fn(() => makeChain(state.selectResults.shift() ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn(async (rows: Array<Record<string, unknown>>) => {
        state.inserted.push(...rows);
        return undefined;
      }),
    })),
  };

  return { dbMock, state };
});

vi.mock('@/server/db', () => ({
  db: dbMock,
  feedItems: {
    recipientUserId: 'feedItems.recipientUserId',
    questionId: 'feedItems.questionId',
    sourceUserId: 'feedItems.sourceUserId',
    sourceType: 'feedItems.sourceType',
    sourceAnswerId: 'feedItems.sourceAnswerId',
  },
  masteryEvents: {
    id: 'masteryEvents.id',
    userId: 'masteryEvents.userId',
    questionId: 'masteryEvents.questionId',
    sourceType: 'masteryEvents.sourceType',
    answerState: 'masteryEvents.answerState',
    createdAt: 'masteryEvents.createdAt',
  },
  questions: {
    id: 'questions.id',
    visibility: 'questions.visibility',
    deletedAt: 'questions.deletedAt',
    creatorId: 'questions.creatorId',
  },
}));

vi.mock('@/server/feed/visibility', () => ({ SOCIAL_FEED_SOURCE_TYPE: 'friend_answered' }));

import {
  backfillFollowedUserFeedItems,
  backfillInviterFeedItems,
  backfillSourceAnswerId,
  dropAlreadyPresent,
  INVITER_BACKFILL_MAX_ITEMS,
  pickInviterBackfillAnswers,
  toBackfillFeedItemRows,
  type InviterAnswerRow,
} from '@/server/feed/backfill-inviter-feed';

const INVITER = 'inviter-1';
const INVITEE = 'invitee-1';

function answerRow(n: number, opts: { questionId?: string; at?: string } = {}): InviterAnswerRow {
  return {
    masteryEventId: `me-${n}`,
    questionId: opts.questionId ?? `q-${n}`,
    answeredAt: new Date(opts.at ?? `2026-06-0${(n % 9) + 1}T12:00:00.000Z`),
  };
}

function masteryDbRows(rows: InviterAnswerRow[]) {
  return rows.map((r) => ({
    masteryEventId: r.masteryEventId,
    questionId: r.questionId,
    answeredAt: r.answeredAt,
  }));
}

beforeEach(() => {
  state.selectResults = [];
  state.inserted = [];
  dbMock.select.mockClear();
  dbMock.insert.mockClear();
});

describe('pure decision helpers', () => {
  it('dedupes by questionId keeping the first (most-recent) occurrence', () => {
    const rows = [
      answerRow(1, { questionId: 'q-a', at: '2026-06-08T12:00:00.000Z' }),
      answerRow(2, { questionId: 'q-a', at: '2026-06-01T12:00:00.000Z' }),
      answerRow(3, { questionId: 'q-b', at: '2026-06-07T12:00:00.000Z' }),
    ];
    const picked = pickInviterBackfillAnswers(rows);
    expect(picked.map((p) => p.questionId)).toEqual(['q-a', 'q-b']);
    expect(picked[0].masteryEventId).toBe('me-1'); // kept the most-recent answer
  });

  it('enforces the cap (8 most recent distinct questions)', () => {
    const rows = Array.from({ length: 12 }, (_, i) => answerRow(i, { questionId: `q-${i}` }));
    const picked = pickInviterBackfillAnswers(rows);
    expect(INVITER_BACKFILL_MAX_ITEMS).toBe(8);
    expect(picked).toHaveLength(8);
    expect(picked.map((p) => p.questionId)).toEqual(rows.slice(0, 8).map((r) => r.questionId));
  });

  it('returns nothing for an empty input', () => {
    expect(pickInviterBackfillAnswers([])).toEqual([]);
  });

  it('drops questions that already have a row (idempotent re-fire)', () => {
    const picked = [answerRow(1, { questionId: 'q-a' }), answerRow(2, { questionId: 'q-b' })];
    expect(dropAlreadyPresent(picked, ['q-a', 'q-b'])).toEqual([]);
    expect(dropAlreadyPresent(picked, ['q-a']).map((p) => p.questionId)).toEqual(['q-b']);
  });

  it('builds feed rows with friend_answered shape, true answer time, and a deterministic id', () => {
    const at = new Date('2026-06-05T09:30:00.000Z');
    const rows = toBackfillFeedItemRows(INVITER, INVITEE, [
      { masteryEventId: 'me-x', questionId: 'q-x', answeredAt: at },
    ]);
    expect(rows).toEqual([
      {
        recipientUserId: INVITEE,
        questionId: 'q-x',
        sourceType: 'friend_answered',
        sourceUserId: INVITER,
        sourceResult: 'correct',
        sourceEventAt: at,
        sourceAnswerId: backfillSourceAnswerId('me-x'),
        state: 'active',
        isPinned: false,
      },
    ]);
    expect(rows[0].sourceAnswerId).toBe('inviter-backfill:me-x');
  });
});

describe('backfillInviterFeedItems (hook)', () => {
  it('creates feed items for the inviter, capped at 8, with truthful ordering', async () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      answerRow(i, { questionId: `q-${i}`, at: `2026-06-08T12:00:0${i}.000Z` }),
    );
    state.selectResults = [masteryDbRows(rows), /* existing */ []];

    const result = await backfillInviterFeedItems({ inviterUserId: INVITER, inviteeUserId: INVITEE });

    expect(result).toEqual({ created: 8 });
    expect(state.inserted).toHaveLength(8);
    expect(state.inserted.every((r) => r.sourceType === 'friend_answered')).toBe(true);
    expect(state.inserted.every((r) => r.sourceUserId === INVITER)).toBe(true);
    expect(state.inserted.every((r) => r.recipientUserId === INVITEE)).toBe(true);
    // sourceEventAt preserves the inviter's original answer time (not now).
    expect(state.inserted[0].sourceEventAt).toEqual(rows[0].answeredAt);
  });

  it('creates nothing when the inviter has no qualifying answers', async () => {
    state.selectResults = [[]]; // no mastery rows; existing select never runs

    const result = await backfillInviterFeedItems({ inviterUserId: INVITER, inviteeUserId: INVITEE });

    expect(result).toEqual({ created: 0 });
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0);
  });

  it('is idempotent on re-fire — inserts no duplicates when rows already exist', async () => {
    const rows = [answerRow(1, { questionId: 'q-a' }), answerRow(2, { questionId: 'q-b' })];
    // 2nd select reports both questions already have a friend_answered row.
    state.selectResults = [masteryDbRows(rows), [{ questionId: 'q-a' }, { questionId: 'q-b' }]];

    const result = await backfillInviterFeedItems({ inviterUserId: INVITER, inviteeUserId: INVITEE });

    expect(result).toEqual({ created: 0 });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('only inserts the not-yet-backfilled subset', async () => {
    const rows = [answerRow(1, { questionId: 'q-a' }), answerRow(2, { questionId: 'q-b' })];
    state.selectResults = [masteryDbRows(rows), [{ questionId: 'q-a' }]];

    const result = await backfillInviterFeedItems({ inviterUserId: INVITER, inviteeUserId: INVITEE });

    expect(result).toEqual({ created: 1 });
    expect(state.inserted.map((r) => r.questionId)).toEqual(['q-b']);
  });

  it('no-ops when inviter and invitee are the same user', async () => {
    const result = await backfillInviterFeedItems({ inviterUserId: INVITER, inviteeUserId: INVITER });
    expect(result).toEqual({ created: 0 });
    expect(dbMock.select).not.toHaveBeenCalled();
  });
});

describe('backfillFollowedUserFeedItems (friend-add hook)', () => {
  const ANSWERER = 'followee-1';
  const RECIPIENT = 'follower-1';

  it('seeds the follower with the followee\'s recent answers, attributed to the followee', async () => {
    const rows = [answerRow(1, { questionId: 'q-a' }), answerRow(2, { questionId: 'q-b' })];
    state.selectResults = [masteryDbRows(rows), /* existing */ []];

    const result = await backfillFollowedUserFeedItems({
      answererUserId: ANSWERER,
      recipientUserId: RECIPIENT,
    });

    expect(result).toEqual({ created: 2 });
    expect(state.inserted.every((r) => r.sourceUserId === ANSWERER)).toBe(true);
    expect(state.inserted.every((r) => r.recipientUserId === RECIPIENT)).toBe(true);
    expect(state.inserted.every((r) => r.sourceType === 'friend_answered')).toBe(true);
  });

  it('no-ops when the followee and follower are the same user', async () => {
    const result = await backfillFollowedUserFeedItems({
      answererUserId: ANSWERER,
      recipientUserId: ANSWERER,
    });
    expect(result).toEqual({ created: 0 });
    expect(dbMock.select).not.toHaveBeenCalled();
  });
});
