import { describe, expect, it } from 'vitest';

import {
  BURST_GAP_MS,
  collectFriendActivityQuestionIds,
  deriveFriendActivity,
  HELD_RELEASE_MS,
  type FriendActivityCard,
  type FriendPlayRow,
} from '@/lib/friend-activity';

// A fixed clock so held-singles release is deterministic.
const NOW = new Date('2026-05-26T00:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let seq = 0;
function play(over: Partial<FriendPlayRow> = {}): FriendPlayRow {
  seq += 1;
  return {
    friendId: 'f-robyn',
    friendName: 'Robyn Hitchcock',
    friendFirstName: 'Robyn',
    questionId: `q-${seq}`,
    answeredAt: new Date('2026-05-20T12:00:00.000Z'),
    context: 'feed',
    batchKey: null,
    playableForViewer: true,
    ...over,
  };
}

const at = (iso: string) => new Date(iso);
const ids = (c: FriendActivityCard) => [...c.questionIds].sort();

describe('deriveFriendActivity — burst grouping (feed/profile)', () => {
  it('clusters feed plays within the gap into one card', () => {
    const cards = deriveFriendActivity(
      [
        play({ questionId: 'a', answeredAt: at('2026-05-20T12:00:00Z') }),
        play({ questionId: 'b', answeredAt: at('2026-05-20T12:10:00Z') }),
        play({ questionId: 'c', answeredAt: at('2026-05-20T12:20:00Z') }),
      ],
      NOW,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].context).toBe('feed');
    expect(cards[0].heldSolo).toBe(false);
    expect(ids(cards[0])).toEqual(['a', 'b', 'c']);
    // effectiveAt = most-recent play in the burst.
    expect(cards[0].effectiveAt).toEqual(at('2026-05-20T12:20:00Z'));
  });

  it('splits plays separated by more than the gap into separate burst cards', () => {
    const cards = deriveFriendActivity(
      [
        // burst A (two playable so it emits without held-buffering)
        play({ questionId: 'a1', answeredAt: at('2026-05-20T12:00:00Z') }),
        play({ questionId: 'a2', answeredAt: at('2026-05-20T12:05:00Z') }),
        // burst B, 3h later
        play({ questionId: 'b1', answeredAt: at('2026-05-20T15:00:00Z') }),
        play({ questionId: 'b2', answeredAt: at('2026-05-20T15:05:00Z') }),
      ],
      NOW,
    );
    expect(cards).toHaveLength(2);
    // newest first
    expect(ids(cards[0])).toEqual(['b1', 'b2']);
    expect(ids(cards[1])).toEqual(['a1', 'a2']);
  });

  it('uses the configured burst gap boundary', () => {
    const justOver = [
      play({ questionId: 'a1', answeredAt: at('2026-05-20T12:00:00Z') }),
      play({ questionId: 'a2', answeredAt: at('2026-05-20T12:00:00Z') }),
      play({ questionId: 'b1', answeredAt: new Date(at('2026-05-20T12:00:00Z').getTime() + BURST_GAP_MS + MIN) }),
      play({ questionId: 'b2', answeredAt: new Date(at('2026-05-20T12:00:00Z').getTime() + BURST_GAP_MS + MIN) }),
    ];
    expect(deriveFriendActivity(justOver, NOW)).toHaveLength(2);
  });
});

describe('deriveFriendActivity — natural-unit grouping (daily/catchup/game)', () => {
  it('groups a daily batch by (friend, day) regardless of the gap between plays', () => {
    const cards = deriveFriendActivity(
      [
        // 8 hours apart — would be two bursts in feed context, but daily is one batch
        play({ context: 'daily', batchKey: '2026-05-20', questionId: 'd1', answeredAt: at('2026-05-20T08:00:00Z') }),
        play({ context: 'daily', batchKey: '2026-05-20', questionId: 'd2', answeredAt: at('2026-05-20T16:00:00Z') }),
      ],
      NOW,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].context).toBe('daily');
    expect(ids(cards[0])).toEqual(['d1', 'd2']);
  });

  it('separates daily batches across days', () => {
    const cards = deriveFriendActivity(
      [
        play({ context: 'daily', batchKey: '2026-05-20', questionId: 'd1', answeredAt: at('2026-05-20T08:00:00Z') }),
        play({ context: 'daily', batchKey: '2026-05-20', questionId: 'd2', answeredAt: at('2026-05-20T09:00:00Z') }),
        play({ context: 'daily', batchKey: '2026-05-21', questionId: 'e1', answeredAt: at('2026-05-21T08:00:00Z') }),
        play({ context: 'daily', batchKey: '2026-05-21', questionId: 'e2', answeredAt: at('2026-05-21T09:00:00Z') }),
      ],
      NOW,
    );
    expect(cards).toHaveLength(2);
    expect(ids(cards[0])).toEqual(['e1', 'e2']); // newest day first
  });

  it('groups a joshing game by its batchKey', () => {
    const cards = deriveFriendActivity(
      [
        play({ context: 'joshing_game', batchKey: 'game-1', questionId: 'g1', answeredAt: at('2026-05-20T12:00:00Z') }),
        play({ context: 'joshing_game', batchKey: 'game-1', questionId: 'g2', answeredAt: at('2026-05-20T12:01:00Z') }),
      ],
      NOW,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].context).toBe('joshing_game');
    expect(ids(cards[0])).toEqual(['g1', 'g2']);
  });
});

describe('deriveFriendActivity — playable dedup', () => {
  it('excludes pre-answered/authored questions from card contents', () => {
    const cards = deriveFriendActivity(
      [
        play({ context: 'daily', batchKey: '2026-05-20', questionId: 'keep1', answeredAt: at('2026-05-20T08:00:00Z') }),
        play({ context: 'daily', batchKey: '2026-05-20', questionId: 'keep2', answeredAt: at('2026-05-20T08:05:00Z') }),
        play({ context: 'daily', batchKey: '2026-05-20', questionId: 'gone', answeredAt: at('2026-05-20T08:06:00Z'), playableForViewer: false }),
      ],
      NOW,
    );
    expect(cards).toHaveLength(1);
    expect(ids(cards[0])).toEqual(['keep1', 'keep2']);
  });

  it('drops a card with zero playable questions', () => {
    const cards = deriveFriendActivity(
      [
        play({ context: 'daily', batchKey: '2026-05-20', questionId: 'x', playableForViewer: false }),
        play({ context: 'daily', batchKey: '2026-05-20', questionId: 'y', playableForViewer: false }),
      ],
      NOW,
    );
    expect(cards).toHaveLength(0);
  });

  it('treats a batch with only one playable question as a singleton (held, not shown)', () => {
    const recent = new Date(NOW.getTime() - 1 * DAY);
    const cards = deriveFriendActivity(
      [
        play({ context: 'daily', batchKey: 'b', questionId: 'one', answeredAt: recent }),
        play({ context: 'daily', batchKey: 'b', questionId: 'pre', answeredAt: recent, playableForViewer: false }),
      ],
      NOW,
    );
    expect(cards).toHaveLength(0); // held, awaiting a companion or the 5-day release
  });
});

describe('deriveFriendActivity — held singles', () => {
  it('holds a lone recent single (no card yet)', () => {
    const recent = new Date(NOW.getTime() - 1 * DAY);
    const cards = deriveFriendActivity([play({ questionId: 'lonely', answeredAt: recent })], NOW);
    expect(cards).toHaveLength(0);
  });

  it('releases a single solo after the 5-day window, sorted at release time', () => {
    const old = new Date(NOW.getTime() - 6 * DAY);
    const cards = deriveFriendActivity([play({ questionId: 'lonely', answeredAt: old })], NOW);
    expect(cards).toHaveLength(1);
    expect(cards[0].heldSolo).toBe(true);
    expect(ids(cards[0])).toEqual(['lonely']);
    expect(cards[0].effectiveAt).toEqual(new Date(old.getTime() + HELD_RELEASE_MS));
  });

  it('flushes two same-friend singletons into one mixed card', () => {
    const cards = deriveFriendActivity(
      [
        // two separate bursts (3h apart) → each a 1-playable draft → held buffer
        play({ questionId: 's1', answeredAt: at('2026-05-20T12:00:00Z') }),
        play({ questionId: 's2', answeredAt: at('2026-05-20T15:00:00Z') }),
      ],
      NOW,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].context).toBe('mixed');
    expect(cards[0].heldSolo).toBe(false);
    expect(ids(cards[0])).toEqual(['s1', 's2']);
    expect(cards[0].effectiveAt).toEqual(at('2026-05-20T15:00:00Z')); // release = companion arrival
  });

  it('never merges singletons across friends', () => {
    const old = new Date(NOW.getTime() - 6 * DAY);
    const cards = deriveFriendActivity(
      [
        play({ friendId: 'f-a', friendFirstName: 'Ann', questionId: 'a', answeredAt: old }),
        play({ friendId: 'f-b', friendFirstName: 'Bo', questionId: 'b', answeredAt: old }),
      ],
      NOW,
    );
    // each releases solo (>5d), never combined into one mixed card
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.heldSolo)).toBe(true);
    expect(new Set(cards.map((c) => c.friendId))).toEqual(new Set(['f-a', 'f-b']));
  });
});

describe('deriveFriendActivity — ordering & helpers', () => {
  it('orders strictly newest-first by effectiveAt', () => {
    const cards = deriveFriendActivity(
      [
        play({ context: 'daily', batchKey: 'd1', questionId: 'x1', answeredAt: at('2026-05-18T10:00:00Z') }),
        play({ context: 'daily', batchKey: 'd1', questionId: 'x2', answeredAt: at('2026-05-18T10:05:00Z') }),
        play({ context: 'daily', batchKey: 'd2', questionId: 'y1', answeredAt: at('2026-05-22T10:00:00Z') }),
        play({ context: 'daily', batchKey: 'd2', questionId: 'y2', answeredAt: at('2026-05-22T10:05:00Z') }),
      ],
      NOW,
    );
    const times = cards.map((c) => c.effectiveAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('collects every playable questionId across cards', () => {
    const cards = deriveFriendActivity(
      [
        play({ context: 'daily', batchKey: 'd', questionId: 'p1', answeredAt: at('2026-05-20T10:00:00Z') }),
        play({ context: 'daily', batchKey: 'd', questionId: 'p2', answeredAt: at('2026-05-20T10:05:00Z') }),
      ],
      NOW,
    );
    expect(collectFriendActivityQuestionIds(cards)).toEqual(new Set(['p1', 'p2']));
  });
});
