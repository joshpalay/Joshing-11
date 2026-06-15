import { describe, expect, it } from 'vitest'

import type { StreamItem } from '@/lib/activity-stream'
import {
  DIRECT_SERVE_CAP,
  HOME_WINDOW_DAYS,
  PLAYABLE_SERVE_CAP,
  TEXTURE_SOFT_CAP,
  boundTexture,
  interleaveByActor,
  orderBySenderRotation,
  orderFriendActivity,
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

  it('uses the full pending total for the direct overflow when the fetched page is capped', () => {
    // 7 items fetched (page cap), but the whole-table count says 40 pending:
    // the overflow must reflect the real abundance, not "fetch limit minus cap".
    const feedItems = Array.from({ length: 7 }, (_, i) =>
      feedItem(`d${i}`, `sender${i}`, `2026-06-11T0${i}:00:00Z`),
    )
    const edition = selectHomeEdition({
      feedItems,
      directPendingTotal: 40,
      activityItems: [],
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    expect(edition.direct.served).toHaveLength(DIRECT_SERVE_CAP)
    expect(edition.direct.overflowCount).toBe(40 - DIRECT_SERVE_CAP)
    // A stale/smaller total never shrinks the overflow below what was fetched.
    const clamped = selectHomeEdition({
      feedItems,
      directPendingTotal: 2,
      activityItems: [],
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    expect(clamped.direct.overflowCount).toBe(7 - DIRECT_SERVE_CAP)
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

// --- From Friends chronological log (D-FEED-FRIEND-ACTIVITY-01 §Q4) -----------

describe('orderFriendActivity — chronological log keeps answered bundles', () => {
  it('retains a fully-answered bundle (it stays as a spent card, not consumed)', () => {
    const edition = selectHomeEdition({
      feedItems: [],
      activityItems: [
        bundleWithResults('b-spent', 'f0', ['correct']),
        ...Array.from({ length: 5 }, (_, i) => playable(`p${i}`, `f${i}`)),
      ],
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    // 6 bundles total (1 spent + 5 pending): all retained, served 4 + 2 overflow.
    // Equal sortAt → stable order → the spent bundle (first in input) is served.
    expect(edition.playables.served.map((p) => p.id)).toContain('b-spent')
    expect(edition.playables.overflowCount).toBe(2)
    expect(edition.playables.served.length + edition.playables.overflowCount).toBe(6)
    // Still never a texture row.
    expect(edition.texture.map((t) => t.id)).not.toContain('b-spent')
  })

  it('does NOT drop a bundle when its last question is answered (Q4)', () => {
    const queue = (items: StreamItem[]) => orderFriendActivity(items).map((i) => i.id)
    const before = [
      bundleWithResults('p0', 'f0', [null]),
      ...Array.from({ length: 5 }, (_, i) => playable(`p${i + 1}`, `f${i + 1}`)),
    ]
    expect(queue(before)).toContain('p0')
    // The viewer answers p0's only question → it stays (now spent), still in the log.
    const after = [bundleWithResults('p0', 'f0', ['correct']), ...before.slice(1)]
    expect(queue(after)).toContain('p0')
    expect(queue(after)).toHaveLength(6)
  })

  it('orders newest-first by sortAt', () => {
    const ordered = orderFriendActivity([
      playable('old', 'f0', 'milestone', '2026-06-09T12:00:00Z'),
      playable('new', 'f1', 'milestone', '2026-06-11T12:00:00Z'),
      playable('mid', 'f2', 'milestone', '2026-06-10T12:00:00Z'),
    ])
    expect(ordered.map((i) => i.id)).toEqual(['new', 'mid', 'old'])
  })
})

// --- selectHomeEdition: texture bounding (§4) --------------------------------

describe('selectHomeEdition — texture', () => {
  it('soft-caps texture at 8 and prefers today-and-yesterday over older items', () => {
    const activityItems = [
      textureItem('t-now', '2026-06-11T17:00:00Z'),
      textureItem('t-yesterday', '2026-06-10T20:00:00Z'),
      textureItem('t-old', '2026-06-01T12:00:00Z'), // fresh items fill the cap → dropped
      ...Array.from({ length: 8 }, (_, i) => textureItem(`t-fresh${i}`, '2026-06-11T1' + (i % 9) + ':00:00Z')),
    ]
    const edition = selectHomeEdition({
      feedItems: [],
      activityItems,
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    expect(edition.texture).toHaveLength(TEXTURE_SOFT_CAP)
    expect(edition.texture.map((t) => t.id)).not.toContain('t-old')
  })

  it('recent-or-nothing: renders fewer than the cap rather than backfilling past the window', () => {
    // now = 2026-06-11T18:00Z, 7-day floor = 2026-06-04T18:00Z.
    const activityItems = [
      textureItem('t-in-newer', '2026-06-05T12:00:00Z'), // in window
      textureItem('t-fresh', '2026-06-11T17:00:00Z'), // in window
      textureItem('t-out', '2026-06-02T12:00:00Z'), // 9 days old → out of window, NOT backfilled
    ]
    const edition = selectHomeEdition({
      feedItems: [],
      activityItems,
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    // Only the two in-window rows, newest-first; the out-of-window row is gone —
    // the backfill branch no longer reaches past the window (audit 4.6).
    expect(edition.texture.map((t) => t.id)).toEqual(['t-fresh', 't-in-newer'])
  })

  it('windows Zone 2: an 8-day-old item is excluded, a 6-day-old item is kept', () => {
    const eightDaysAgo = new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString()
    const sixDaysAgo = new Date(NOW - 6 * 24 * 60 * 60 * 1000).toISOString()
    const edition = selectHomeEdition({
      feedItems: [],
      activityItems: [textureItem('t-8d', eightDaysAgo), textureItem('t-6d', sixDaysAgo)],
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    expect(edition.texture.map((t) => t.id)).toEqual(['t-6d'])
  })
})

// --- boundTexture (recent-or-nothing within the home window) -----------------

describe('boundTexture', () => {
  it('caps the output and keeps all rows in-window when more than the cap exist', () => {
    const items = Array.from({ length: TEXTURE_SOFT_CAP + 4 }, (_, i) =>
      textureItem(`t${i}`, new Date(NOW - i * 60 * 60 * 1000).toISOString()),
    )
    const out = boundTexture(items, NOW)
    expect(out).toHaveLength(TEXTURE_SOFT_CAP)
    const floor = NOW - HOME_WINDOW_DAYS * 24 * 60 * 60 * 1000
    expect(out.every((t) => t.sortAt.getTime() >= floor)).toBe(true)
  })

  it('returns exactly the in-window count when fewer than the cap exist (no older backfill)', () => {
    const items = [
      textureItem('in-1', new Date(NOW - 1 * 24 * 60 * 60 * 1000).toISOString()),
      textureItem('in-2', new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString()),
      // Two well-aged rows that the old backfill branch would have appended.
      textureItem('old-1', new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString()),
      textureItem('old-2', new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString()),
    ]
    const out = boundTexture(items, NOW)
    expect(out.map((t) => t.id)).toEqual(['in-1', 'in-2'])
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

// --- Zone 1 (direct) stays all-time / unwindowed -----------------------------

describe('selectHomeEdition — Zone 1 is not windowed', () => {
  it('serves a direct question older than the home window (unwindowed guarantee)', () => {
    // 20 days old — well past HOME_WINDOW_DAYS. Zone 2 would drop this; Zone 1
    // must still serve it (a question a friend sent you never ages out).
    const old = new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString()
    const edition = selectHomeEdition({
      feedItems: [feedItem('d-old', 'sender', old)],
      activityItems: [],
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    expect(edition.direct.served.map((d) => d.id)).toEqual(['d-old'])
  })
})

// --- Per-section empty signal (model point 4) --------------------------------

function convergenceItem(id: string, sortAtIso: string): StreamItem {
  return {
    id,
    friendId: 'f-conv',
    relationship: 'convergence',
    sortAt: new Date(sortAtIso),
    expand: { kind: 'same_correct', questions: [] },
  } as unknown as StreamItem
}

describe('selectHomeEdition — per-section empty signal', () => {
  it('emits an explicit empty flag for each Zone-2 section with nothing in-window', () => {
    const edition = selectHomeEdition({
      feedItems: [],
      activityItems: [],
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    expect(edition.emptySections).toEqual({
      fromFriends: true,
      texture: true,
      sharedGround: true,
    })
  })

  it('clears the per-section flag only for the sections that have in-window items', () => {
    const edition = selectHomeEdition({
      feedItems: [],
      activityItems: [
        playable('p0', 'f0'), // From Friends bundle
        convergenceItem('c0', '2026-06-11T15:00:00Z'), // Shared Ground (in window)
      ],
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    expect(edition.emptySections.fromFriends).toBe(false)
    expect(edition.emptySections.sharedGround).toBe(false)
  })

  it('treats an out-of-window section as empty', () => {
    const old = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString()
    const edition = selectHomeEdition({
      feedItems: [],
      activityItems: [convergenceItem('c-old', old)],
      promos: { sharedGround: null, expanding: null, growCircle: null },
      now: NOW,
    })
    expect(edition.emptySections.sharedGround).toBe(true)
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
