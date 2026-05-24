import { describe, expect, it } from 'vitest';

import { filterUtilityActivities } from '@/app/activities/filter-utility-activities';
import type { ActivityItemView } from '@/server/db/queries/activity';
import type { LatelyMoment } from '@/server/db/queries/lately';

function directQuestionActivity(
  id: string,
  feedItemId: string,
  questionId: string,
): ActivityItemView {
  return {
    id,
    userId: 'viewer-1',
    type: 'received_direct_question',
    actorUserId: 'sender-1',
    referenceId: feedItemId,
    referenceType: 'feed_item',
    read: false,
    createdAt: new Date('2026-05-24T12:00:00.000Z'),
    actor: { displayName: 'Testing account 1' },
    reference: {
      directQuestion: {
        feedItemId,
        questionId,
        questionText: 'Stephen Sondheim question text…',
        personalMessage: null,
        category: 'Stephen Sondheim musicals',
      },
    },
  };
}

function youGotThemMoment(questionId: string): LatelyMoment {
  return {
    momentId: `moment-${questionId}`,
    dir: 'you_got_them',
    friendId: 'sender-1',
    friendName: 'Testing account 1',
    friendFirstName: 'Testing',
    questionId,
    questionText: 'Stephen Sondheim question text…',
    category: 'Stephen Sondheim musicals',
    gameTitle: 'asterisk',
    answeredAt: new Date('2026-05-24T11:01:00.000Z'),
  };
}

function theyGotYouMoment(questionId: string): LatelyMoment {
  return {
    ...youGotThemMoment(questionId),
    momentId: `tgyou-${questionId}`,
    dir: 'they_got_you',
  };
}

function friendAnsweredActivity(
  id: string,
  result: 'correct' | 'incorrect',
): ActivityItemView {
  return {
    id,
    userId: 'viewer-1',
    type: 'friend_answered_your_question',
    actorUserId: 'friend-1',
    referenceId: 'q-1',
    referenceType: 'question',
    read: false,
    createdAt: new Date('2026-05-24T12:00:00.000Z'),
    actor: { displayName: 'A friend' },
    reference: {
      friendAnsweredQuestion: { domain: 'music', result },
    },
  };
}

function declaredPromotedActivity(id: string): ActivityItemView {
  return {
    id,
    userId: 'viewer-1',
    type: 'declared_promoted',
    actorUserId: 'friend-1',
    referenceId: 'q-1',
    referenceType: 'question',
    read: false,
    createdAt: new Date('2026-05-24T12:00:00.000Z'),
    actor: { displayName: 'A friend' },
    reference: {
      declaredPromoted: { domain: 'music', questionText: 'q' },
    },
  };
}

describe('filterUtilityActivities', () => {
  it('drops received_direct_question when a you_got_them moment covers the same questionId', () => {
    const items = [directQuestionActivity('a-1', 'fi-1', 'q-sondheim')];
    const moments = [youGotThemMoment('q-sondheim')];

    expect(filterUtilityActivities(items, moments)).toEqual([]);
  });

  it('keeps received_direct_question when no matching moment exists (unanswered or wrong)', () => {
    const items = [directQuestionActivity('a-1', 'fi-1', 'q-sondheim')];

    expect(filterUtilityActivities(items, [])).toHaveLength(1);
  });

  it('keeps received_direct_question when only a they_got_you moment exists (different direction)', () => {
    const items = [directQuestionActivity('a-1', 'fi-1', 'q-sondheim')];
    const moments = [theyGotYouMoment('q-sondheim')];

    expect(filterUtilityActivities(items, moments)).toHaveLength(1);
  });

  it('keeps received_direct_question for a different questionId than the moment', () => {
    const items = [directQuestionActivity('a-1', 'fi-1', 'q-other')];
    const moments = [youGotThemMoment('q-sondheim')];

    expect(filterUtilityActivities(items, moments)).toHaveLength(1);
  });

  it('still drops friend_answered_your_question (correct) and declared_promoted', () => {
    const items = [
      friendAnsweredActivity('a-1', 'correct'),
      friendAnsweredActivity('a-2', 'incorrect'),
      declaredPromotedActivity('a-3'),
    ];

    const kept = filterUtilityActivities(items, []);
    expect(kept.map((i) => i.id)).toEqual(['a-2']);
  });
});
