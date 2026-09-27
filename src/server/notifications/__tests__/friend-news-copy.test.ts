import { describe, expect, it } from 'vitest';

import type { FriendNews } from '@/server/db/queries/friend-news';
import type { QueueSlot } from '@/server/daily/types';
import {
  dailyEmailFriendLines,
  friendAuthorsInSlots,
  smsFriendLine,
  weeklyDigestSections,
} from '@/server/notifications/friend-news-copy';

// Local copy (not imported) so this test never loads the DB module.
const EMPTY_FRIEND_NEWS: FriendNews = {
  answeredYourQuestions: [],
  newQuestionsFromFriends: [],
  newFriends: [],
  invitedStarted: [],
};

function news(partial: Partial<FriendNews>): FriendNews {
  return { ...EMPTY_FRIEND_NEWS, ...partial };
}

function slot(partial: Partial<QueueSlot>): QueueSlot {
  return { slot_index: 0, source: 'bot', answered: false, ...partial } as QueueSlot;
}

describe('friendAuthorsInSlots', () => {
  it('names friends who wrote an unanswered slot, once each, never the viewer or the house', () => {
    const slots = [
      slot({ source: 'friend', author_id: 'neil', author_name: 'Neil' }),
      slot({ source: 'friend', author_id: 'neil', author_name: 'Neil' }),
      slot({ source: 'friend', author_id: 'sam', author_name: 'Sam', answered: true }),
      slot({ source: 'friend', author_id: 'me', author_name: 'Me' }),
      slot({ source: 'house', author_name: 'Joshing' }),
      slot({ source: 'friend', author_id: 'ada', author_name: 'Ada' }),
    ];
    expect(friendAuthorsInSlots(slots, 'me')).toEqual(['Neil', 'Ada']);
  });
});

describe('smsFriendLine', () => {
  it('is null on a quiet day, so the plain reminder goes out', () => {
    expect(smsFriendLine(EMPTY_FRIEND_NEWS, [])).toBeNull();
  });

  it('puts an invite that stuck ahead of everything else', () => {
    const line = smsFriendLine(
      news({
        invitedStarted: [{ friendId: 'm', name: 'Maya' }],
        answeredYourQuestions: [{ friendId: 'n', name: 'Neil', total: 2, correct: 1 }],
      }),
      ['Ada'],
    );
    expect(line).toBe('Maya just played a first five. Your invite worked.');
  });

  it('says how many of your questions one friend answered', () => {
    expect(
      smsFriendLine(news({ answeredYourQuestions: [{ friendId: 'n', name: 'Neil', total: 2, correct: 0 }] }), []),
    ).toBe('Neil answered 2 of your questions.');
    expect(
      smsFriendLine(news({ answeredYourQuestions: [{ friendId: 'n', name: 'Neil', total: 1, correct: 1 }] }), []),
    ).toBe('Neil answered one of your questions.');
  });

  it('groups several answering friends without a count', () => {
    const line = smsFriendLine(
      news({
        answeredYourQuestions: [
          { friendId: 'n', name: 'Neil', total: 3, correct: 3 },
          { friendId: 's', name: 'Sam', total: 1, correct: 0 },
          { friendId: 'a', name: 'Ada', total: 1, correct: 1 },
        ],
      }),
      [],
    );
    expect(line).toBe('Neil, Sam and 1 other answered your questions.');
  });

  it('falls back to a friend question in today’s five, then a new friend', () => {
    expect(smsFriendLine(EMPTY_FRIEND_NEWS, ['Neil'])).toBe("Neil wrote one of today's five.");
    expect(smsFriendLine(news({ newFriends: [{ friendId: 'm', name: 'Maya' }] }), [])).toBe(
      'You and Maya are now friends.',
    );
  });
});

describe('dailyEmailFriendLines', () => {
  it('lists up to three lines in priority order', () => {
    const lines = dailyEmailFriendLines(
      news({
        invitedStarted: [{ friendId: 'm', name: 'Maya' }],
        answeredYourQuestions: [{ friendId: 'n', name: 'Neil', total: 2, correct: 1 }],
        newFriends: [{ friendId: 'z', name: 'Zed' }],
      }),
      ['Ada'],
    );
    expect(lines).toEqual([
      'Maya just played a first five. Your invite worked.',
      'Neil answered 2 of your questions.',
      "Ada wrote one of today's five.",
    ]);
  });

  it('is empty on a quiet day', () => {
    expect(dailyEmailFriendLines(EMPTY_FRIEND_NEWS, [])).toEqual([]);
  });
});

describe('weeklyDigestSections', () => {
  it('returns nothing for a quiet week, so no email is sent', () => {
    expect(weeklyDigestSections(EMPTY_FRIEND_NEWS)).toEqual([]);
  });

  it('builds one section per kind of news, dropping empty ones', () => {
    const sections = weeklyDigestSections(
      news({
        answeredYourQuestions: [
          { friendId: 'n', name: 'Neil', total: 3, correct: 2 },
          { friendId: 's', name: 'Sam', total: 1, correct: 1 },
          { friendId: 'a', name: 'Ada', total: 1, correct: 0 },
        ],
        newFriends: [{ friendId: 'z', name: 'Zed' }],
        invitedStarted: [{ friendId: 'm', name: 'Maya' }],
      }),
    );
    expect(sections).toEqual([
      {
        heading: 'Your questions',
        lines: ['Neil answered 3 and got 2.', 'Sam answered one and got it.', 'Ada answered one.'],
      },
      {
        heading: 'New faces',
        lines: ['Maya started playing. Your invite worked.', 'You and Zed are now friends.'],
      },
    ]);
  });

  it('counts new questions waiting from friends', () => {
    expect(
      weeklyDigestSections(
        news({
          newQuestionsFromFriends: [
            { friendId: 'n', name: 'Neil', count: 2 },
            { friendId: 's', name: 'Sam', count: 1 },
          ],
        }),
      ),
    ).toEqual([
      {
        heading: 'Waiting for you',
        lines: ['Neil wrote 2 new questions.', 'Sam wrote a new question.'],
      },
    ]);
  });
});
