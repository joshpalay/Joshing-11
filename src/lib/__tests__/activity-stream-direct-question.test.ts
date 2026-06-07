import { describe, expect, it } from 'vitest';

import { activityToStreamItem } from '@/lib/activity-stream';
import type { ActivityItemView } from '@/server/db/queries/activity';

function directQuestionActivity(
  overrides?: Partial<NonNullable<ActivityItemView['reference']['directQuestion']>>,
): ActivityItemView {
  return {
    id: 'a-1',
    userId: 'viewer-1',
    type: 'received_direct_question',
    actorUserId: 'sender-1',
    referenceId: 'fi-1',
    referenceType: 'feed_item',
    read: false,
    createdAt: new Date('2026-05-24T12:00:00.000Z'),
    actor: { displayName: 'Sadie' },
    reference: {
      directQuestion: {
        feedItemId: 'fi-1',
        questionId: 'q-catch22',
        questionText: 'Why was Major Major promoted in Catch-22?',
        personalMessage: null,
        category: 'Catch-22',
        ...overrides,
      },
    },
  };
}

describe('activityToStreamItem — received_direct_question', () => {
  it('offers an inline answer_direct action (not a link back to home)', () => {
    const item = activityToStreamItem(directQuestionActivity());

    expect(item.action).toEqual({
      kind: 'answer_direct',
      feedItemId: 'fi-1',
      questionId: 'q-catch22',
      questionText: 'Why was Major Major promoted in Catch-22?',
      domain: 'Catch-22',
    });
    expect(item.secondLine).toBe('Why was Major Major promoted in Catch-22?');
    expect(item.icon).toBe('hourglass');
  });

  it('falls back to the home link only when the feed-item reference is missing', () => {
    const item = activityToStreamItem({
      ...directQuestionActivity(),
      reference: {},
    });

    expect(item.action).toEqual({ kind: 'link', href: '/', label: 'Answer' });
  });
});
