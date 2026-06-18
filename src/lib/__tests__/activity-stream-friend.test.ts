import { describe, expect, it } from 'vitest'

import { activityToStreamItem, momentToStreamItem } from '@/lib/activity-stream'
import type { ActivityItemView } from '@/server/db/queries/activity'
import type { LatelyMoment } from '@/server/db/queries/lately'

// Per-person grouping keys off StreamItem.friendId, set at construction. These
// tests pin which builders carry a friend and which are friend-less.

function activity(type: ActivityItemView['type'], over: Partial<ActivityItemView> = {}): ActivityItemView {
  return {
    id: 'act-1',
    userId: 'viewer-1',
    type,
    actorUserId: 'friend-1',
    referenceId: 'ref-1',
    referenceType: 'mastery_event',
    read: false,
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
    actor: { displayName: 'Robyn' },
    reference: { masteryEvent: { tier: 'Fluent', domain: 'Jazz' } },
    ...over,
  } as unknown as ActivityItemView
}

describe('StreamItem.friendId', () => {
  it('tags a friend acting (friend_mastery) with the actor id', () => {
    expect(activityToStreamItem(activity('friend_mastery')).friendId).toBe('friend-1')
  })

  it('leaves the viewer-only broadcast (authored_question_shared) friend-less', () => {
    const item = activityToStreamItem(
      activity('authored_question_shared', {
        reference: { authoredSharedQuestion: { recipientCount: 3, domain: 'Jazz' } },
      } as unknown as Partial<ActivityItemView>),
    )
    expect(item.friendId).toBeNull()
  })

  it('surfaces a follow request’s suggested interests on the feed row', () => {
    const item = activityToStreamItem(
      activity('follow_request', {
        referenceType: 'follow',
        reference: {
          friendshipRequest: {
            id: 'fr-1',
            status: 'pending',
            requestedByUserId: 'friend-1',
            suggestedInterests: ['Sondheim', 'Mrs. Dalloway'],
          },
        },
      } as unknown as Partial<ActivityItemView>),
    )
    expect(item.secondLine).toBe('Sondheim · Mrs. Dalloway')
    expect(item.secondLineVoice).toBe('system')
    expect(item.action).toEqual({ kind: 'friend_request', friendshipId: 'fr-1' })
  })

  it('leaves the follow request row’s second line empty when no interests were flagged', () => {
    const item = activityToStreamItem(
      activity('follow_request', {
        referenceType: 'follow',
        reference: {
          friendshipRequest: {
            id: 'fr-2',
            status: 'pending',
            requestedByUserId: 'friend-1',
            suggestedInterests: [],
          },
        },
      } as unknown as Partial<ActivityItemView>),
    )
    expect(item.secondLine).toBeNull()
    expect(item.secondLineVoice).toBeUndefined()
  })

  it('tags a moment with the moment friend id', () => {
    const moment: LatelyMoment = {
      momentId: 'm-1',
      dir: 'they_got_you',
      friendId: 'friend-9',
      friendName: 'Sadie',
      friendFirstName: 'Sadie',
      questionId: 'q-1',
      questionText: 'Who is Bird?',
      category: 'Jazz',
      answeredAt: new Date('2026-06-01T12:00:00.000Z'),
    }
    expect(momentToStreamItem(moment).friendId).toBe('friend-9')
  })
})
