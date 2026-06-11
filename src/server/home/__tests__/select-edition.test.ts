import { describe, expect, it } from 'vitest'

import type { StreamItem } from '@/lib/activity-stream'
import {
  DIRECT_SERVE_CAP,
  PLAYABLE_SERVE_CAP,
  interleaveByActor,
  isPendingPlayable,
  orderBySenderRotation,
  orderPendingPlayables,
  selectHomeEdition,
  type FeedEditionItem,
} from '@/server/home/select-edition'

// --- Fixtures ----------------------------------------------------------------
// selectHomeEdition only reads a handful of fields off each shape, so the
// fixtures stay minimal and cast to the public types.

function feedItem(id: string, sender: string, sentAtIso: string): FeedEditionItem {
  return {
    id,
    source_user_id: sender,
    source_event_at: sentAtIso,
  } as unknown as FeedEditionItem
}

function playable(id: string, friendId: string, type = 'milestone', sortAt = '2026-06-11T12:00:00Z'): StreamItem {
  return {
    id,
    friendId,
    relationship: type === 'milestone' ? undefined : (type as StreamItem['relationship']),
    sortAt: new Date(sortAt),
    expand: { kind: 'milestone', questions: [{ questionId: `${id}-q` }] },
  } as unknown as StreamItem
}

// A bundle whose questions carry the given viewer results (null = unanswered).
function bundleWithResults(
  id: string,
  friendId: string,
  results: Array<'correct' | 'incorrect' | null>,
): StreamItem {
  return {
    id,
    friendId,
    sortAt: new Date('2026-06-11T12:00:00Z'),
    expand: {
      kind: 'milestone',
      questions: results.map((priorResult, i) => ({ questionId: `${id}-q${i}`, priorResult })),
    },
  } as unknown as StreamItem
}

function textureItem(id: string, sortAtIso: string, friendId: string | null = 'f-tex'): StreamItem {
  return {
    id,
    friendId,
    sortAt: new Date(sortAtIso),
    expand: null,
  } as unknown as StreamItem
}

function promo(id: string, kind: 'common_ground' | 'recently_expanding' | 'add_friends'): StreamItem {
  return {
    id,
    friendId: null,
    sortAt: new Date('2026-06-11T12:00:00Z'),
    expand: null,
    embed: { kind },
  } as unknown as StreamItem
}

const NOW = Date.parse('2026-06-11T18:00:00Z')

function actorsOf(items: StreamItem[]): (string | null)[] {
  return items.map((i) => i.friendId ?? null)
}

// --- orderBySenderRotation (§5 serving order) --------------------------------

describe('orderBySenderRotation', () => {
  it('rotates by sender, oldest-first within sender, no sender buried', () => {
    // Robyn sent 1 (a while ago); Joshua sent 3 (more recent). Robyn must not be
    // buried beneath Joshua's monologue, and Joshua's three are spaced out.
    const items = [
      feedItem('j1', 'joshua', '2026-06-11T09:00:00Z'),
      feedItem('j2', 'joshua', '2026-06-11T10:00:00Z'),
      feedItem('j3', 'joshua', '2026-06-11T11:00:00Z'),
      feedItem('r1', 'robyn', '2026-06-11T08:00:00Z'),
    ]
    const ordered = orderBySenderRotation(
      items,
      (i) => i.source_user_id,
      (i) => Date.parse(i.source_event_at),
    )
    // Robyn (oldest waiter) leads; then round-robin with Joshua oldest-first.
    expect(ordered.map((i) => i.id)).toEqual(['r1', 'j1', 'j2', 'j3'])
  })
})

// --- interleaveByActor (§5 actor-interleave) ---------------------------------

describe('interleaveByActor', () => {
  it('breaks up a chatty actor so no two consecutive slots share an actor', () => {
    // Joshua is chatty (4 items); Robyn has 1. With variety available there must
    // be no two consecutive Joshua slots until Robyn is spent.
    const items = [
      playable('a1', 'joshua'),
      playable('a2', 'joshua'),
      playable('a3', 'joshua'),
      playable('r1', 'robyn'),
      playable('a4', 'joshua'),
    ]
    const out = interleaveByActor(items, (i) => i.friendId ?? null, () => 'milestone')
    const actors = actorsOf(out)
    // Robyn separates the first two Joshuas; once Robyn is spent the remaining
    // Joshuas necessarily run (pool no longer permits variety).
    expect(actors[0]).toBe('joshua')
    expect(actors[1]).toBe('robyn')
    // Across the first three slots (while variety is available) no repeat.
    expect(actors[0]).not.toBe(actors[1])
  })

  it('degenerate single-actor pool prefers event-type variety', () => {
    // Only Joshua. Actor variety is impossible, so the fallback spaces EVENT
    // TYPES: went-deep / got-you should not stack when they can alternate.
    const items = [
      playable('a1', 'joshua', 'you_got'),
      playable('a2', 'joshua', 'you_got'),
      playable('a3', 'joshua', 'got_you'),
    ]
    const out = interleaveByActor(items, (i) => i.friendId ?? null, (i) => i.relationship ?? 'milestone')
    const types = out.map((i) => i.relationship ?? 'milestone')
    // The two you_got items are not adjacent — got_you is pulled between them.
    expect(types[0]).toBe('you_got')
    expect(types[1]).toBe('got_you')
    expect(types[2]).toBe('you_got')
  })
})

// --- selectHomeEdition: budget & overflow (§2/§3) ----------------------------

describe('selectHomeEdition — serve-and-overflow', () => {
  it('serves Direct 3 / Playables 4 and reports the remainder as overflow', () => {
    const feedItems = Array.from({ length: 7 }, (_, i) =>
      feedItem(`d${i}`, `sender${i}`, `2026-06-11T0${i}:00:00Z`),
    )
    const playables = Array.from({ length: 9 }, (_, i) => playable(`p${i}`, `friend${i % 4}`))

    const edition = selectHomeEdition({
      feedItems,
      activityItems: playables,
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })

    expect(edition.direct.served).toHaveLength(DIRECT_SERVE_CAP)
    expect(edition.direct.overflowCount).toBe(7 - DIRECT_SERVE_CAP)
    expect(edition.playables.served).toHaveLength(PLAYABLE_SERVE_CAP)
    expect(edition.playables.overflowCount).toBe(9 - PLAYABLE_SERVE_CAP)
  })

  it('reports zero overflow when a zone is under budget', () => {
    const edition = selectHomeEdition({
      feedItems: [feedItem('d0', 's0', '2026-06-11T09:00:00Z')],
      activityItems: [playable('p0', 'f0')],
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    expect(edition.direct.overflowCount).toBe(0)
    expect(edition.playables.overflowCount).toBe(0)
  })
})

// --- pending-playable definition (B-HOME-OVERFLOW-02 §7) ----------------------

describe('isPendingPlayable / orderPendingPlayables — §7 pending definition', () => {
  it('a bundle is pending only while ≥1 question is unanswered', () => {
    expect(isPendingPlayable(bundleWithResults('b-fresh', 'f0', [null, null]))).toBe(true)
    expect(isPendingPlayable(bundleWithResults('b-partial', 'f0', ['correct', null]))).toBe(true)
    expect(isPendingPlayable(bundleWithResults('b-spent', 'f0', ['correct', 'incorrect']))).toBe(false)
  })

  it('fully-answered bundles leave the playable queue, the count, and texture', () => {
    const edition = selectHomeEdition({
      feedItems: [],
      activityItems: [
        bundleWithResults('b-spent', 'f0', ['correct']),
        ...Array.from({ length: 5 }, (_, i) => playable(`p${i}`, `f${i}`)),
      ],
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    // 5 pending bundles: served 4 + 1 overflow — the spent one counts nowhere.
    expect(edition.playables.served.map((p) => p.id)).not.toContain('b-spent')
    expect(edition.playables.overflowCount).toBe(1)
    // Consumed, not texture: it does not fall through as an ambient row.
    expect(edition.texture.map((t) => t.id)).not.toContain('b-spent')
  })

  it('answering the last question of a served bundle promotes the next one (§7 round trip)', () => {
    const queue = (items: StreamItem[]) => orderPendingPlayables(items).map((i) => i.id)
    const before = [
      bundleWithResults('p0', 'f0', [null]),
      ...Array.from({ length: 5 }, (_, i) => playable(`p${i + 1}`, `f${i + 1}`)),
    ]
    expect(queue(before).slice(0, PLAYABLE_SERVE_CAP)).toContain('p0')
    // The viewer answers p0's only question on the subpage → next read shows it spent.
    const after = [
      bundleWithResults('p0', 'f0', ['correct']),
      ...before.slice(1),
    ]
    const served = queue(after).slice(0, PLAYABLE_SERVE_CAP)
    expect(served).not.toContain('p0')
    expect(served).toContain('p4') // promoted into the freed slot
    expect(queue(after)).toHaveLength(5)
  })
})

// --- selectHomeEdition: texture bounding (§4) --------------------------------

describe('selectHomeEdition — texture', () => {
  it('bounds texture to today-and-yesterday and soft-caps it', () => {
    const activityItems = [
      textureItem('t-now', '2026-06-11T17:00:00Z'),
      textureItem('t-yesterday', '2026-06-10T20:00:00Z'),
      textureItem('t-old', '2026-06-01T12:00:00Z'), // > 2 days → dropped
      ...Array.from({ length: 8 }, (_, i) => textureItem(`t-fresh${i}`, '2026-06-11T1' + (i % 9) + ':00:00Z')),
    ]
    const edition = selectHomeEdition({
      feedItems: [],
      activityItems,
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    expect(edition.texture.length).toBeLessThanOrEqual(5)
    expect(edition.texture.map((t) => t.id)).not.toContain('t-old')
  })
})

// --- selectHomeEdition: empty switch (§9) ------------------------------------

describe('selectHomeEdition — empty switch', () => {
  it('all three content zones empty → isAllEmpty, panel suppressed', () => {
    const edition = selectHomeEdition({
      feedItems: [],
      activityItems: [],
      promos: {
        sharedGround: promo('sg', 'common_ground'),
        expanding: promo('ex', 'recently_expanding'),
        growCircle: promo('gc', 'add_friends'),
      },
      now: NOW,
    })
    expect(edition.isAllEmpty).toBe(true)
    expect(edition.panel).toBeNull()
  })

  it('partial-empty (direct empty, playables present) → not all-empty, panel chosen', () => {
    const edition = selectHomeEdition({
      feedItems: [],
      activityItems: [playable('p0', 'f0'), playable('p1', 'f1')],
      promos: {
        sharedGround: promo('sg', 'common_ground'),
        expanding: null,
        growCircle: promo('gc', 'add_friends'),
      },
      now: NOW,
    })
    expect(edition.isAllEmpty).toBe(false)
    expect(edition.direct.served).toHaveLength(0)
    expect(edition.playables.served).toHaveLength(2)
    expect(edition.panel).not.toBeNull()
  })
})

// --- selectHomeEdition: panel selection (§2 slot 5) --------------------------

describe('selectHomeEdition — panel', () => {
  it('biases a quiet page to Grow Your Circle', () => {
    const edition = selectHomeEdition({
      feedItems: [feedItem('d0', 's0', '2026-06-11T09:00:00Z')],
      activityItems: [], // quiet: ≤2 activity items
      promos: {
        sharedGround: promo('sg', 'common_ground'),
        expanding: null,
        growCircle: promo('gc', 'add_friends'),
      },
      now: NOW,
    })
    expect(edition.panel?.id).toBe('gc')
  })

  it('prefers Shared Ground on an active page', () => {
    const edition = selectHomeEdition({
      feedItems: [],
      activityItems: [
        textureItem('t0', '2026-06-11T17:00:00Z'),
        textureItem('t1', '2026-06-11T16:00:00Z'),
        textureItem('t2', '2026-06-11T15:00:00Z'),
      ],
      promos: {
        sharedGround: promo('sg', 'common_ground'),
        expanding: null,
        growCircle: promo('gc', 'add_friends'),
      },
      now: NOW,
    })
    expect(edition.panel?.id).toBe('sg')
  })
})
