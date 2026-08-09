import { describe, expect, it } from 'vitest';

import {
  MISSED_RETURN_LIFETIME_CAP,
  MISSED_RETURN_PER_SESSION_CAP,
  rankReturnCandidates,
  selectReturnCandidates,
  type ReturnCandidate,
} from '@/server/daily/missed-return';
import { getCoreSlots, isAdditiveSlot, isBonusSlot, isReturnSlot } from '@/server/daily/bonus';
import { canonicalPointsForAnswer } from '@/lib/game-constants';
import {
  CATCHUP_SURFACE_WEIGHT,
  RECOVERY_STATE_WEIGHT,
} from '@/server/mastery/constants';
import { getBasePoints } from '@/server/mastery/scoring';
import type { QueueSlot } from '@/server/daily/types';

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

function candidate(over: Partial<ReturnCandidate> = {}): ReturnCandidate {
  return {
    kind: 'canonical',
    questionId: 'q1',
    scope: 'wrong',
    lastSeenAt: day(1),
    returnCount: 0,
    ...over,
  };
}

function slot(over: Partial<QueueSlot> = {}): QueueSlot {
  return {
    slot_index: 0,
    source: 'friend',
    domain: 'jazz',
    question_text: 'q?',
    answered: false,
    ...over,
  } as QueueSlot;
}

describe('D-MISSED-RETURN-01 — ranking and selection (§2 R2, R8)', () => {
  it('ranks expired ahead of wrong — unseen beats re-seen', () => {
    // The wrong one is OLDER, so only the scope rule can put expired first.
    const ranked = rankReturnCandidates([
      candidate({ questionId: 'wrong', scope: 'wrong', lastSeenAt: day(1) }),
      candidate({ questionId: 'expired', scope: 'expired', lastSeenAt: day(20) }),
    ]);
    expect(ranked.map((c) => c.questionId)).toEqual(['expired', 'wrong']);
  });

  it('orders longest-since-last-seen first within a scope, so the backlog drains', () => {
    const ranked = rankReturnCandidates([
      candidate({ questionId: 'recent', lastSeenAt: day(20) }),
      candidate({ questionId: 'oldest', lastSeenAt: day(2) }),
      candidate({ questionId: 'middle', lastSeenAt: day(10) }),
    ]);
    expect(ranked.map((c) => c.questionId)).toEqual(['oldest', 'middle', 'recent']);
  });

  it('is deterministic on ties', () => {
    const input = [
      candidate({ questionId: 'b', lastSeenAt: day(3) }),
      candidate({ questionId: 'a', lastSeenAt: day(3) }),
    ];
    expect(rankReturnCandidates(input).map((c) => c.questionId)).toEqual(['a', 'b']);
    // Pure — the input array is not mutated.
    expect(input.map((c) => c.questionId)).toEqual(['b', 'a']);
  });

  it('caps at ONE return per session, never two (R2)', () => {
    const selected = selectReturnCandidates([
      candidate({ questionId: 'a', scope: 'expired', lastSeenAt: day(1) }),
      candidate({ questionId: 'b', scope: 'expired', lastSeenAt: day(2) }),
      candidate({ questionId: 'c', scope: 'wrong', lastSeenAt: day(3) }),
    ]);
    expect(selected).toHaveLength(1);
    expect(MISSED_RETURN_PER_SESSION_CAP).toBe(1);
    expect(selected[0].questionId).toBe('a');
  });

  it('selects nothing from an empty candidate set', () => {
    expect(selectReturnCandidates([])).toEqual([]);
  });

  it('caps lifetime returns at 3 (R7)', () => {
    expect(MISSED_RETURN_LIFETIME_CAP).toBe(3);
  });
});

describe('D-MISSED-RETURN-01 — the return slot is APPENDED, never one of the five (§2 R3)', () => {
  it('marks a slot as a return iff it carries return_scope', () => {
    expect(isReturnSlot(slot({ return_scope: 'wrong' }))).toBe(true);
    expect(isReturnSlot(slot({ return_scope: 'expired' }))).toBe(true);
    expect(isReturnSlot(slot())).toBe(false);
  });

  it('does not confuse a return slot with a +2 bonus slot', () => {
    const returnSlot = slot({ return_scope: 'wrong' });
    expect(isBonusSlot(returnSlot)).toBe(false);
    expect(isAdditiveSlot(returnSlot)).toBe(true);

    const bonus = slot({ presence_source_id: 'u1' });
    expect(isReturnSlot(bonus)).toBe(false);
    expect(isAdditiveSlot(bonus)).toBe(true);
  });

  it('keeps the core five at five when a return slot is appended', () => {
    const slots = [
      slot({ slot_index: 0 }),
      slot({ slot_index: 1 }),
      slot({ slot_index: 2 }),
      slot({ slot_index: 3 }),
      slot({ slot_index: 4 }),
      slot({ slot_index: 5, presence_source_id: 'u1' }),
      slot({ slot_index: 6, return_scope: 'wrong' }),
    ];
    // Six slots would mean a friend's fresh question lost its seat to a repeat.
    expect(getCoreSlots(slots)).toHaveLength(5);
  });
});

describe('D-MISSED-RETURN-01 §5 — the scoring table, one test per row', () => {
  const difficulty = 'moderate' as const;
  const liveBase = getBasePoints(difficulty, 'first_correct');

  it('returning wrong → correct: RECOVERY_STATE_WEIGHT of the full live base', () => {
    const points = canonicalPointsForAnswer({
      difficulty,
      answerState: 'first_correct_after_wrong',
      catchUp: true, // what the return slot passes
    });
    expect(points).toBe(Math.round(liveBase * RECOVERY_STATE_WEIGHT));
    // MAX-not-compound (D-RECOVERY-SCORING-UNIFY-01 D1): recovery REPLACES the
    // catch-up surface weight rather than stacking to 6.25%.
    expect(points).not.toBe(
      Math.round(liveBase * RECOVERY_STATE_WEIGHT * CATCHUP_SURFACE_WEIGHT),
    );
  });

  it('returning wrong → wrong again: 0', () => {
    expect(
      canonicalPointsForAnswer({ difficulty, answerState: 'incorrect', catchUp: true }),
    ).toBe(0);
  });

  it('returning expired → correct: CATCHUP_SURFACE_WEIGHT, not live credit', () => {
    const points = canonicalPointsForAnswer({
      difficulty,
      answerState: 'first_correct',
      catchUp: true,
    });
    expect(points).toBe(Math.round(liveBase * CATCHUP_SURFACE_WEIGHT));
    // The bug this guards: without catchUp the same answer scores FULL live
    // credit, because the player genuinely never answered it before.
    expect(points).not.toBe(
      canonicalPointsForAnswer({ difficulty, answerState: 'first_correct' }),
    );
  });

  it('returning expired → wrong: 0', () => {
    expect(
      canonicalPointsForAnswer({ difficulty, answerState: 'incorrect', catchUp: true }),
    ).toBe(0);
  });
});
