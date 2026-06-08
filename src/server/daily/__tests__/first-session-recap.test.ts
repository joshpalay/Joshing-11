import { describe, expect, it } from 'vitest';

import {
  computeFirstSessionRecapBeats,
  isFirstSessionRecapEligible,
  pickFirstName,
  type FirstSessionRecapQuestion,
} from '@/server/daily/first-session-recap';

function q(
  domainDisplayName: string,
  isCorrect: boolean,
  isSkipped = false,
): FirstSessionRecapQuestion {
  return { domainDisplayName, isCorrect, isSkipped };
}

describe('isFirstSessionRecapEligible (first-session detection)', () => {
  it('is TRUE on the first completed round when never seen', () => {
    expect(
      isFirstSessionRecapEligible({ seenAt: null, isFirstCompletedRound: true }),
    ).toBe(true);
  });

  it('is FALSE once the recap has been seen', () => {
    expect(
      isFirstSessionRecapEligible({
        seenAt: new Date('2026-06-08T12:00:00.000Z'),
        isFirstCompletedRound: true,
      }),
    ).toBe(false);
  });

  it('is FALSE when this is not the first completed round', () => {
    expect(
      isFirstSessionRecapEligible({ seenAt: null, isFirstCompletedRound: false }),
    ).toBe(false);
  });
});

describe('pickFirstName', () => {
  it('takes the first token', () => {
    expect(pickFirstName('Ada Lovelace')).toBe('Ada');
  });
  it('returns empty string when there is no usable name', () => {
    expect(pickFirstName('   ')).toBe('');
    expect(pickFirstName(null)).toBe('');
  });
});

describe('computeFirstSessionRecapBeats — Beat 1', () => {
  it('always carries the first name', () => {
    const view = computeFirstSessionRecapBeats({
      displayName: 'Grace Hopper',
      questions: [q('History', true)],
      inviter: null,
      inviterBackfillItemCount: 0,
    });
    expect(view.type).toBe('first_session');
    expect(view.firstName).toBe('Grace');
  });
});

describe('computeFirstSessionRecapBeats — Beat 2 (discovery framing)', () => {
  const inviterless = { inviter: null, inviterBackfillItemCount: 0 } as const;

  it('lists distinct touched domains in first-seen order', () => {
    const view = computeFirstSessionRecapBeats({
      displayName: 'X',
      questions: [
        q('History', true),
        q('History', false),
        q('Science', true),
        q('Film Tv', false),
      ],
      ...inviterless,
    });
    expect(view.beat2?.touchedDomains).toEqual(['History', 'Science', 'Film Tv']);
  });

  it('omits the new-territory line when every answer is correct', () => {
    const view = computeFirstSessionRecapBeats({
      displayName: 'X',
      questions: [q('History', true), q('Science', true)],
      ...inviterless,
    });
    expect(view.beat2?.offTheGroundDomain).toBe('History');
    expect(view.beat2?.newTerritoryDomain).toBeNull();
  });

  it('omits the off-the-ground line when none are correct', () => {
    const view = computeFirstSessionRecapBeats({
      displayName: 'X',
      questions: [q('History', false), q('Science', false)],
      ...inviterless,
    });
    expect(view.beat2?.offTheGroundDomain).toBeNull();
    expect(view.beat2?.newTerritoryDomain).toBe('History');
  });

  it('picks a distinct domain for new territory so the two lines never collide', () => {
    const view = computeFirstSessionRecapBeats({
      displayName: 'X',
      // History: one correct + one wrong; Science: one wrong.
      questions: [q('History', true), q('History', false), q('Science', false)],
      ...inviterless,
    });
    expect(view.beat2?.offTheGroundDomain).toBe('History');
    expect(view.beat2?.newTerritoryDomain).toBe('Science');
  });

  it('chooses the domain with the most correct answers as off-the-ground', () => {
    const view = computeFirstSessionRecapBeats({
      displayName: 'X',
      questions: [q('History', true), q('Science', true), q('Science', true)],
      ...inviterless,
    });
    expect(view.beat2?.offTheGroundDomain).toBe('Science');
  });

  it('treats a skipped question as touched but not correct/wrong', () => {
    const view = computeFirstSessionRecapBeats({
      displayName: 'X',
      questions: [q('History', false, true), q('Science', true)],
      ...inviterless,
    });
    expect(view.beat2?.touchedDomains).toEqual(['History', 'Science']);
    expect(view.beat2?.offTheGroundDomain).toBe('Science');
    // The skipped History question must not become "new territory".
    expect(view.beat2?.newTerritoryDomain).toBeNull();
  });

  it('returns a null beat2 for an empty session', () => {
    const view = computeFirstSessionRecapBeats({
      displayName: 'X',
      questions: [],
      ...inviterless,
    });
    expect(view.beat2).toBeNull();
  });
});

describe('computeFirstSessionRecapBeats — Beat 3 branch selection', () => {
  const questions = [q('History', true)];

  it('PRESENT tense when the inviter backfill seeded the home feed', () => {
    const view = computeFirstSessionRecapBeats({
      displayName: 'X',
      questions,
      inviter: { name: 'Lin' },
      inviterBackfillItemCount: 3,
    });
    expect(view.beat3).toEqual({ kind: 'inviter_present', inviterName: 'Lin' });
  });

  it('FUTURE tense when an inviter exists but nothing was backfilled', () => {
    const view = computeFirstSessionRecapBeats({
      displayName: 'X',
      questions,
      inviter: { name: 'Lin' },
      inviterBackfillItemCount: 0,
    });
    expect(view.beat3).toEqual({ kind: 'inviter_future', inviterName: 'Lin' });
  });

  it('NO-INVITER variant when there is no inviter on record', () => {
    const view = computeFirstSessionRecapBeats({
      displayName: 'X',
      questions,
      inviter: null,
      inviterBackfillItemCount: 0,
    });
    expect(view.beat3).toEqual({ kind: 'no_inviter' });
  });
});
