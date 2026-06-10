import { describe, expect, it } from 'vitest'

import {
  groupActivityByFriend,
  groupableFriendId,
  type GroupInputRow,
} from '@/components/feed/person-grouping'
import type { StreamExpand, StreamItem, StreamEmbed } from '@/lib/activity-stream'

// Per-person grouping (home feed tier 2/3). These helpers are pure, so they're
// tested directly without rendering FeedList.

function activityRow(
  id: string,
  over: Partial<StreamItem> = {},
): GroupInputRow<string> {
  const item: StreamItem = {
    id,
    sortAt: new Date('2026-06-01T00:00:00Z'),
    tier: 3,
    homeEligible: true,
    line: [{ t: 'text', v: id }],
    secondLine: null,
    anchorId: null,
    action: null,
    expand: null,
    icon: null,
    ...over,
  }
  return {
    kind: 'activity',
    sortMs: item.sortAt.getTime(),
    source_event_at: item.sortAt.toISOString(),
    item,
  }
}

function feedRow(id: string): GroupInputRow<string> {
  return { kind: 'feed', sortMs: 0, source_event_at: '2026-06-01T00:00:00Z', item: id }
}

const MILESTONE_EXPAND: StreamExpand = {
  kind: 'milestone',
  friendId: 'f1',
  friendName: 'Robyn',
  questions: [],
}
const COMMON_GROUND_EMBED: Extract<StreamEmbed, { kind: 'common_ground' }> = {
  kind: 'common_ground',
  friendId: 'f1',
  friendFirstName: 'Robyn',
  friendHref: '/users/f1',
  friends: [],
}

describe('groupableFriendId', () => {
  it('returns the friendId for a plain relationship activity row', () => {
    expect(groupableFriendId(activityRow('a', { friendId: 'f1' }))).toBe('f1')
  })

  it('never groups feed cards, milestones, embeds, or friend-less rows', () => {
    expect(groupableFriendId(feedRow('q'))).toBeNull()
    expect(groupableFriendId(activityRow('m', { friendId: 'f1', expand: MILESTONE_EXPAND }))).toBeNull()
    expect(groupableFriendId(activityRow('e', { friendId: 'f1', embed: COMMON_GROUND_EMBED }))).toBeNull()
    expect(groupableFriendId(activityRow('x', { friendId: null }))).toBeNull()
  })
})

describe('groupActivityByFriend', () => {
  it('collapses ≥2 events from one friend into a single person card', () => {
    const rows = [
      activityRow('a1', { friendId: 'f1' }),
      activityRow('a2', { friendId: 'f1' }),
    ]
    const out = groupActivityByFriend(rows)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('person')
    if (out[0]!.kind === 'person') {
      expect(out[0]!.friendId).toBe('f1')
      expect(out[0]!.rows.map((r) => r.id)).toEqual(['a1', 'a2'])
      // Inherits the newest (first) member's chronological slot.
      expect(out[0]!.source_event_at).toBe(rows[0]!.source_event_at)
    }
  })

  it('leaves a lone friend event as an ordinary row', () => {
    const out = groupActivityByFriend([activityRow('a1', { friendId: 'f1' })])
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('activity')
  })

  it('passes through feed cards, milestones, and friend-less rows untouched', () => {
    const rows = [
      feedRow('q1'),
      activityRow('m', { friendId: 'f1', expand: MILESTONE_EXPAND }),
      activityRow('shared', { friendId: null }),
    ]
    const out = groupActivityByFriend(rows)
    expect(out.map((r) => r.kind)).toEqual(['feed', 'activity', 'activity'])
  })

  it('gathers one friend while another friend and unrelated rows keep their place', () => {
    const rows = [
      activityRow('a1', { friendId: 'f1' }),
      feedRow('q1'),
      activityRow('b1', { friendId: 'f2' }), // lone → stays a line
      activityRow('a2', { friendId: 'f1' }), // pulled up into f1's card
    ]
    const out = groupActivityByFriend(rows)
    // f1 card at a1's slot, then the feed card, then f2's lone line. a2 is folded
    // into the f1 card and no longer appears on its own.
    expect(out.map((r) => r.kind)).toEqual(['person', 'feed', 'activity'])
    const personCard = out[0]
    if (personCard?.kind === 'person') {
      expect(personCard.friendId).toBe('f1')
      expect(personCard.rows.map((r) => r.id)).toEqual(['a1', 'a2'])
    }
  })
})
