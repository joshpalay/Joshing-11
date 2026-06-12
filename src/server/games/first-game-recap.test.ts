import { describe, expect, it } from 'vitest';

import {
  computeFirstGameRecapBeats,
  isFirstGameRecapEligible,
  pickFirstName,
  type FirstGameRecapQuestion,
} from '@/server/games/first-game-recap';

function q(
  domainDisplayName: string,
  isCorrect: boolean,
  isSkipped = false,
): FirstGameRecapQuestion {
  return { domainDisplayName, isCorrect, isSkipped };
}

describe('isFirstGameRecapEligible', () => {
  it('is TRUE for the first completed game when never seen', () => {
    expect(
      isFirstGameRecapEligible({
        seenAt: null,
        isCurrentGameComplete: true,
        isFirstCompletedGame: true,
      }),
    ).toBe(true);
  });

  it('is FALSE once the recap has been seen', () => {
    expect(
      isFirstGameRecapEligible({
        seenAt: new Date('2026-06-08T12:00:00.000Z'),
        isCurrentGameComplete: true,
        isFirstCompletedGame: true,
      }),
    ).toBe(false);
  });

  it('is FALSE when the current game is not complete', () => {
    expect(
      isFirstGameRecapEligible({
        seenAt: null,
        isCurrentGameComplete: false,
        isFirstCompletedGame: true,
      }),
    ).toBe(false);
  });

  it('is FALSE when another game was completed first', () => {
    expect(
      isFirstGameRecapEligible({
        seenAt: null,
        isCurrentGameComplete: true,
        isFirstCompletedGame: false,
      }),
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

describe('computeFirstGameRecapBeats', () => {
  it('builds the first-game recap view', () => {
    const view = computeFirstGameRecapBeats({
      displayName: 'Grace Hopper',
      gameTitle: 'Friday Night Trivia',
      questions: [q('History', true)],
    });

    expect(view.type).toBe('first_game');
    expect(view.firstName).toBe('Grace');
    expect(view.gameTitle).toBe('Friday Night Trivia');
  });

  it('lists distinct touched domains in first-seen order', () => {
    const view = computeFirstGameRecapBeats({
      displayName: 'X',
      gameTitle: 'Game',
      questions: [q('History', true), q('History', false), q('Science', true), q('Film Tv', false)],
    });

    expect(view.beat2?.touchedDomains).toEqual(['History', 'Science', 'Film Tv']);
  });

  it('uses discovery framing for wrong answers without colliding with off-the-ground', () => {
    const view = computeFirstGameRecapBeats({
      displayName: 'X',
      gameTitle: 'Game',
      questions: [q('History', true), q('History', false), q('Science', false)],
    });

    expect(view.beat2?.offTheGroundDomain).toBe('History');
    expect(view.beat2?.newTerritoryDomain).toBe('Science');
  });

  it('treats skipped questions as touched but not wrong', () => {
    const view = computeFirstGameRecapBeats({
      displayName: 'X',
      gameTitle: 'Game',
      questions: [q('History', false, true), q('Science', true)],
    });

    expect(view.beat2?.touchedDomains).toEqual(['History', 'Science']);
    expect(view.beat2?.offTheGroundDomain).toBe('Science');
    expect(view.beat2?.newTerritoryDomain).toBeNull();
  });
});
