import { beforeEach, describe, expect, it, vi } from 'vitest';

// G2 fix: getFriendActivity's "via" attribution used to name a relay source
// with NO check at all -- discovery-attribution.ts's composeDiscoveryAttribution
// already applies a stranger check + discoverableByForward opt-in to the
// identical signal elsewhere in the app. This file confirms getFriendActivity
// now applies the SAME two checks before a via-name reaches card.viaByQuestionId,
// and that a failing via is simply omitted (the card/question still renders,
// per composeDiscoveryAttribution's own per-item omission behavior) rather than
// dropping anything.
//
// deriveFriendActivity (the pure card-grouping transform) runs for REAL here --
// it's DB-free and already covered by its own tests -- so this test only
// controls the raw query rows and the two gate functions, then asserts on the
// real resulting cards' viaByQuestionId.

const { dbMock, state, getRelationshipsMock, getForwardDiscoverableMock } = vi.hoisted(() => {
  const state = { rows: [] as unknown[] };

  function makeChain() {
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'groupBy']) {
      chain[method] = vi.fn(() => chain);
    }
    // limit() is the actual terminal call of getFriendActivity's main query;
    // nested notExists(db.select()...) subqueries never call limit(), so they
    // just get this same inert chain object back, which is fine -- they're
    // never awaited on their own.
    chain.limit = vi.fn(() => Promise.resolve(state.rows));
    return chain;
  }

  const dbMock = { select: vi.fn(() => makeChain()) };
  const getRelationshipsMock = vi.fn(async () => new Map());
  const getForwardDiscoverableMock = vi.fn(async () => new Set<string>());

  return { dbMock, state, getRelationshipsMock, getForwardDiscoverableMock };
});

vi.mock('@/server/db', () => ({
  db: dbMock,
  feedItems: {
    sourceUserId: 'feedItems.sourceUserId',
    recipientUserId: 'feedItems.recipientUserId',
    sourceType: 'feedItems.sourceType',
    sourceResult: 'feedItems.sourceResult',
    questionId: 'feedItems.questionId',
    sourceEventAt: 'feedItems.sourceEventAt',
    sourceAnswerId: 'feedItems.sourceAnswerId',
    joshingGameId: 'feedItems.joshingGameId',
    viaUserId: 'feedItems.viaUserId',
    state: 'feedItems.state',
  },
  follows: {
    followeeId: 'follows.followeeId',
    followerId: 'follows.followerId',
    state: 'follows.state',
  },
  masteryEvents: {},
  milestoneDismissed: {},
  questions: { id: 'questions.id', creatorId: 'questions.creatorId' },
  users: { id: 'users.id', displayName: 'users.displayName' },
}));

vi.mock('@/server/db/queries/follow-visibility', () => ({
  approvedFollowExists: vi.fn(() => undefined),
  mutualFollowApproved: vi.fn(() => undefined),
}));

vi.mock('@/server/feed/visibility', () => ({
  ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES: ['direct_sent'],
  SOCIAL_FEED_SOURCE_TYPE: 'friend_answered',
  notBlocked: vi.fn(() => undefined),
  notBlockedForViewer: vi.fn(() => undefined),
}));

vi.mock('@/server/db/queries/friend-requests', () => ({
  getRelationships: getRelationshipsMock,
}));

vi.mock('@/server/db/queries/account', () => ({
  getForwardDiscoverable: getForwardDiscoverableMock,
}));

import { getFriendActivity } from '@/server/db/queries/lately';

const VIEWER = 'viewer-1';
const FRIEND = 'friend-1';
const VIA = 'via-stranger-1';

// A 'daily:'-prefixed sourceAnswerId (see parsePlayContext) resolves to
// context: 'daily', and batchKeyFor derives the batch key from answeredAt's
// calendar day -- so two rows sharing an answeredAt day are automatically one
// batch. Two playable rows in one batch is what makes deriveFriendActivity
// emit a card immediately (a lone row gets held for a possible 5-day solo
// release instead, per HELD_RELEASE_MS) -- every test below that inspects
// cards[0] passes two rows for exactly this reason.
function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    friendId: FRIEND,
    friendDisplayName: 'Friend One',
    questionId: 'q1',
    sourceAnswerId: 'daily:prop-key',
    joshingGameId: null,
    creatorId: null,
    answeredAt: new Date('2026-09-10T12:00:00Z'),
    viaUserId: VIA,
    viaName: 'Via Person',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  getRelationshipsMock.mockResolvedValue(new Map());
  getForwardDiscoverableMock.mockResolvedValue(new Set());
});

describe('getFriendActivity via-attribution gate (G2 fix)', () => {
  it('shows the via name when the via-person is a stranger AND opted in (checks pass -- unchanged behavior)', async () => {
    state.rows = [
      row({ questionId: 'q1', sourceAnswerId: 'live:2026-09-10' }),
      row({ questionId: 'q2', sourceAnswerId: 'live:2026-09-10' }),
    ];
    getRelationshipsMock.mockResolvedValue(new Map([[VIA, { state: 'none', isBlocked: false }]]));
    getForwardDiscoverableMock.mockResolvedValue(new Set([VIA]));

    const cards = await getFriendActivity(VIEWER);

    expect(cards).toHaveLength(1);
    expect(cards[0]!.viaByQuestionId).toEqual({
      q1: { userId: VIA, name: 'Via Person' },
      q2: { userId: VIA, name: 'Via Person' },
    });
  });

  it('omits the via name when the via-person is NOT a stranger (e.g. already friends)', async () => {
    state.rows = [row({ questionId: 'q1' }), row({ questionId: 'q2' })];
    getRelationshipsMock.mockResolvedValue(new Map([[VIA, { state: 'friends', isBlocked: false }]]));
    getForwardDiscoverableMock.mockResolvedValue(new Set([VIA])); // opted in, but stranger gate fails first

    const cards = await getFriendActivity(VIEWER);

    expect(cards).toHaveLength(1);
    expect(cards[0]!.viaByQuestionId).toBeUndefined();
    // The stranger gate runs first; opt-in is never even checked for a
    // non-stranger (mirrors getDiscoveryAttributionForItems's ordering).
    expect(getForwardDiscoverableMock).not.toHaveBeenCalled();
  });

  it('omits the via name when the via-person is blocked, even though the follow state is "none"', async () => {
    state.rows = [row({ questionId: 'q1' }), row({ questionId: 'q2' })];
    getRelationshipsMock.mockResolvedValue(new Map([[VIA, { state: 'none', isBlocked: true }]]));

    const cards = await getFriendActivity(VIEWER);

    expect(cards[0]!.viaByQuestionId).toBeUndefined();
  });

  it('omits the via name when the via-person is a stranger but has NOT opted into discoverableByForward', async () => {
    state.rows = [row({ questionId: 'q1' }), row({ questionId: 'q2' })];
    getRelationshipsMock.mockResolvedValue(new Map([[VIA, { state: 'none', isBlocked: false }]]));
    getForwardDiscoverableMock.mockResolvedValue(new Set()); // not opted in

    const cards = await getFriendActivity(VIEWER);

    expect(cards[0]!.viaByQuestionId).toBeUndefined();
  });

  it('treats a via-person with no relationship row at all as a clean stranger (matches getRelationships semantics)', async () => {
    state.rows = [row({ questionId: 'q1' }), row({ questionId: 'q2' })];
    getRelationshipsMock.mockResolvedValue(new Map()); // no entry for VIA at all
    getForwardDiscoverableMock.mockResolvedValue(new Set([VIA]));

    const cards = await getFriendActivity(VIEWER);

    expect(cards[0]!.viaByQuestionId).toEqual({
      q1: { userId: VIA, name: 'Via Person' },
      q2: { userId: VIA, name: 'Via Person' },
    });
  });

  it('a gated-out via omits ONLY the via field -- the card and its question still render', async () => {
    state.rows = [row({ questionId: 'q1' }), row({ questionId: 'q2' })];
    getRelationshipsMock.mockResolvedValue(new Map([[VIA, { state: 'friends', isBlocked: false }]]));

    const cards = await getFriendActivity(VIEWER);

    expect(cards).toHaveLength(1);
    expect(cards[0]!.friendId).toBe(FRIEND);
    expect(cards[0]!.questionIds).toContain('q1');
    expect(cards[0]!.questionIds).toContain('q2');
    expect(cards[0]!.viaByQuestionId).toBeUndefined();
  });

  it('never gates on the viewer\'s own id ("via you" stays dropped, unaffected by the new gate)', async () => {
    state.rows = [
      row({ questionId: 'q1', viaUserId: VIEWER, viaName: 'Viewer Name' }),
      row({ questionId: 'q2', viaUserId: VIEWER, viaName: 'Viewer Name' }),
    ];

    const cards = await getFriendActivity(VIEWER);

    expect(cards[0]!.viaByQuestionId).toBeUndefined();
    expect(getRelationshipsMock).not.toHaveBeenCalled();
  });

  it('skips both gate calls entirely when no row carries a via candidate (no wasted queries)', async () => {
    state.rows = [
      row({ questionId: 'q1', viaUserId: null, viaName: null }),
      row({ questionId: 'q2', viaUserId: null, viaName: null }),
    ];

    await getFriendActivity(VIEWER);

    expect(getRelationshipsMock).not.toHaveBeenCalled();
    expect(getForwardDiscoverableMock).not.toHaveBeenCalled();
  });

  it('batches: calls each gate function exactly once regardless of row count (no N+1)', async () => {
    state.rows = [
      row({ questionId: 'q1' }),
      row({ questionId: 'q2', viaUserId: 'via-stranger-2', viaName: 'Via Two' }),
      row({ questionId: 'q3', friendId: 'friend-2', viaUserId: 'via-stranger-3', viaName: 'Via Three' }),
    ];
    getRelationshipsMock.mockResolvedValue(
      new Map([
        [VIA, { state: 'none', isBlocked: false }],
        ['via-stranger-2', { state: 'none', isBlocked: false }],
        ['via-stranger-3', { state: 'none', isBlocked: false }],
      ]),
    );
    getForwardDiscoverableMock.mockResolvedValue(new Set([VIA, 'via-stranger-2', 'via-stranger-3']));

    await getFriendActivity(VIEWER);

    expect(getRelationshipsMock).toHaveBeenCalledTimes(1);
    expect(getForwardDiscoverableMock).toHaveBeenCalledTimes(1);
  });
});
