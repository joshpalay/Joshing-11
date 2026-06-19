/**
 * Home edition selection & budget layer (D-HOME-PACING-01 §2/§3/§5/§7/§9).
 *
 * Turns the three unbounded Home content zones into a fixed-budget edition:
 * per request it computes the *served* slice of each zone, the *overflow count*
 * for the question zones, and the bounded texture set. Home becomes a windowed
 * view of the pending queues rather than a render of everything.
 *
 * This is the data contract only. It does NOT restyle cards (B-VISUAL-CARD-
 * TIERS-01) and does NOT build the overflow subpages (B-HOME-OVERFLOW-02). It
 * also does NOT change how any row renders — the locked Group 3 chronological
 * full-sentence lone-event treatment survives unchanged; this layer only
 * *selects* which events fill the playable zone and *bounds* the texture set.
 *
 * `selectHomeEdition` is a pure function (DB-free, deterministic given `now`)
 * so the budgeting/interleaving rules are unit-testable without a database.
 * `buildHomeEdition` is the thin server wrapper that runs the existing queries
 * and feeds them in.
 */

import type { StreamItem } from '@/lib/activity-stream'
import type { FeedPagePayload } from '@/server/feed/get-feed-page'

/** One item in the question feed payload Home already renders. */
export type FeedEditionItem = FeedPagePayload['items'][number]

// §2 budget — served caps. These are serving sizes, not access ceilings: the
// overflow is always reachable via the subpages (B-HOME-OVERFLOW-02).
export const DIRECT_SERVE_CAP = 3
export const PLAYABLE_SERVE_CAP = 4
// Tuned 2026-06-12: the texture zone runs three rows, then the rotating panel
// as a mid-zone interlude, then up to five more rows (FeedList owns the panel
// placement; this layer just bounds the set).
export const TEXTURE_SOFT_CAP = 8

// D-HOME-DASHBOARD-MODEL-01: Home is a bounded 7-day dashboard. Zone 2 (the
// ambient band — From Friends, Recent Activity/texture, Shared Ground) shows
// only what landed in the rolling now − HOME_WINDOW_DAYS window; Zone 1
// (direct / For You) is deliberately NOT windowed (a question a friend sent you
// never ages out). One source of truth: the Zone-2 source queries each take a
// window parameter defaulted to their own wider historical value, and the home
// caller passes THIS constant. Never hardcode `7` at a call site.
export const HOME_WINDOW_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** A served zone: the top-N window plus the count still pending behind it. */
export type ServedZone<T> = {
  served: T[]
  /** Items beyond the served window — drives the quiet "N more →" affordance. */
  overflowCount: number
}

export type HomeEdition = {
  /**
   * Direct ("For You") zone — every question a friend sent or broadcast to you.
   * Broadcasts (`authored_shared`) live WITHIN this zone (product decision),
   * budgeted together with directly-sent questions. Cap 3, serve-and-overflow,
   * rotate-by-sender / oldest-first within sender (§5).
   */
  direct: ServedZone<FeedEditionItem>
  /**
   * From Friends activity log — milestone bundles (pending OR answered),
   * newest-first. Cap 4, serve-and-overflow; answered bundles stay as spent
   * cards and drift down by recency (D-FEED-FRIEND-ACTIVITY-01 §Q4). The field
   * name stays `playables` for the page/FeedList contract it already feeds.
   */
  playables: ServedZone<StreamItem>
  /**
   * Texture — chronological full-sentence lone social events (locked Group 3),
   * newest-first, bounded to the rolling home window (now − HOME_WINDOW_DAYS),
   * soft-capped (~8). Recent-or-nothing: no history backfill, so a quiet stretch
   * renders fewer rows rather than reaching past the window. No overflow subpage.
   */
  texture: StreamItem[]
  /**
   * The mid-feed panel slot. Now dedicated to the Overlap ("Shared Ground")
   * interlude; null on the all-empty page (§9) or when the viewer has no shared
   * ground. (World Expanding was sunset and Grow Your Circle was promoted to its
   * own always-on slot — see `growCircle`.)
   */
  panel: StreamItem | null
  /**
   * The always-on "Find friends" (Grow Your Circle) interlude. Rendered above
   * the Write composer at the feed tail — NOT in the mid-feed panel slot — so it
   * surfaces on every load rather than competing for the single panel. Null only
   * when the promo itself is absent.
   */
  growCircle: StreamItem | null
  /**
   * True when all three CONTENT zones are empty (§9). Hero and composer are
   * never counted. Drives the two-state empty switch: when true, Home renders
   * the existing empty state inline and suppresses the panel.
   */
  isAllEmpty: boolean
  /**
   * Per-section "this Zone-2 section has nothing in-window" signal (model
   * point 4). Emitted EXPLICITLY — rather than silently omitting the section —
   * so the band restructure (B-HOME-BAND-LABEL-04) can render an honest
   * per-section empty state instead of hiding or back-filling it. Each flag is
   * true when that section has zero items inside the rolling home window.
   * Zone 1 (direct) is never windowed and is intentionally absent here.
   */
  emptySections: {
    /** From Friends bundles (the `playables` zone). */
    fromFriends: boolean
    /** Recent Activity / texture rows. */
    texture: boolean
    /** Shared Ground / convergence rows (currently folded into texture; -04 splits them out). */
    sharedGround: boolean
  }
}

function ms(value: string | Date): number {
  const t = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(t) ? 0 : t
}

/**
 * §5 serving order for the direct zone: rotate by sender, oldest-first within
 * each sender. If Robyn sent 1 and Joshua sent 7, Robyn's does not get buried,
 * and Joshua's seven are spaced across visits rather than arriving as a
 * monologue. No sender's question dies of old age because someone chattier
 * exists. Pure: the same input always yields the same order.
 */
export function orderBySenderRotation<T>(
  items: readonly T[],
  senderOf: (item: T) => string,
  sentAt: (item: T) => number,
): T[] {
  const bySender = new Map<string, T[]>()
  for (const item of items) {
    const key = senderOf(item)
    const bucket = bySender.get(key)
    if (bucket) bucket.push(item)
    else bySender.set(key, [item])
  }
  // Oldest-first within each sender.
  for (const bucket of bySender.values()) {
    bucket.sort((a, b) => sentAt(a) - sentAt(b))
  }
  // Sender turn order: the sender whose oldest pending item has waited longest
  // takes the first turn, so a one-question sender isn't buried behind a chatty
  // one. Ties broken by sender key for determinism.
  const senders = [...bySender.entries()]
    .sort((a, b) => {
      const delta = sentAt(a[1][0]!) - sentAt(b[1][0]!)
      return delta !== 0 ? delta : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
    })
    .map(([key]) => key)
  const out: T[] = []
  for (let round = 0; ; round++) {
    let advanced = false
    for (const key of senders) {
      const next = bySender.get(key)![round]
      if (next !== undefined) {
        out.push(next)
        advanced = true
      }
    }
    if (!advanced) break
  }
  return out
}

/**
 * §5 actor-interleave for the playable zone: no two consecutive items from the
 * same actor where the pool permits. Degenerate case (one or two actors — the
 * actual launch condition): when actor variety is impossible, prefer variety of
 * EVENT TYPE so a friend's items read as a relationship, not surveillance.
 *
 * Greedy and stable: input priority order (prominence) is preserved except
 * where a swap is needed to break an actor repeat (or, in the degenerate case, a
 * type repeat). There is no existing positional interleaver in the daily
 * algorithm to reuse — its diversity rule is a per-subcategory admission cap —
 * so this is a purpose-built helper for the playable zone.
 */
export function interleaveByActor<T>(
  items: readonly T[],
  actorOf: (item: T) => string | null,
  typeOf: (item: T) => string,
): T[] {
  const remaining = [...items]
  const out: T[] = []
  let lastActor: string | null | undefined
  let lastType: string | undefined
  while (remaining.length > 0) {
    // Prefer a different actor AND a different type; fall back to just a
    // different actor; in the degenerate single-actor tail, break the type run.
    let index = remaining.findIndex(
      (item) => actorOf(item) !== lastActor && typeOf(item) !== lastType,
    )
    if (index === -1) {
      index = remaining.findIndex((item) => actorOf(item) !== lastActor)
    }
    if (index === -1) {
      index = remaining.findIndex((item) => typeOf(item) !== lastType)
    }
    if (index === -1) index = 0
    const [picked] = remaining.splice(index, 1)
    out.push(picked!)
    lastActor = actorOf(picked!)
    lastType = typeOf(picked!)
  }
  return out
}

/**
 * §2 slot 4 / D-HOME-DASHBOARD-MODEL-01 — texture is bounded to the rolling
 * home window (now − HOME_WINDOW_DAYS) and soft-capped, newest-first.
 * Recent-or-nothing (audit 4.6): take what exists IN-WINDOW up to the cap; if
 * fewer than the cap exist, render fewer. The old 48h-preferred-then-backfill
 * branch is gone — a quiet stretch leaves the zone short rather than reaching
 * past the window for older items. Both the window and the cap bound the page.
 */
export function boundTexture(
  items: readonly StreamItem[],
  now: number,
  cap = TEXTURE_SOFT_CAP,
  windowDays = HOME_WINDOW_DAYS,
): StreamItem[] {
  const floor = now - windowDays * DAY_MS
  return [...items]
    .filter((item) => ms(item.sortAt) >= floor)
    .sort((a, b) => ms(b.sortAt) - ms(a.sortAt))
    .slice(0, cap)
}

/** A milestone bundle (≥1 question), pending or fully spent. */
function isMilestoneBundle(item: StreamItem): boolean {
  return item.expand?.kind === 'milestone' && item.expand.questions.length > 0
}

/**
 * §5 zone order for the direct ("For You") queue — the one ordering Home's
 * served slice, the overflow count, and the /for-you subpage all window.
 */
export function orderDirectPending(
  items: readonly FeedEditionItem[],
): FeedEditionItem[] {
  return orderBySenderRotation(
    items,
    (item) => item.source_user_id,
    (item) => ms(item.source_event_at),
  )
}

/**
 * Zone order for the From Friends activity log (D-FEED-FRIEND-ACTIVITY-01):
 * EVERY friend-activity bundle — pending OR fully answered — newest-first. A
 * played bundle stays put as a spent card and drifts down by recency rather than
 * leaving the surface; this is the chronological-log model, and it deliberately
 * reverses the old §7 "pending-only" filter that consumed a bundle the moment
 * its last question was answered. Home serves the top 4 of this; the
 * /from-friends subpage renders all of it.
 */
export function orderFriendActivity(
  items: readonly StreamItem[],
): StreamItem[] {
  return [...items]
    .filter(isMilestoneBundle)
    .sort((a, b) => ms(b.sortAt) - ms(a.sortAt))
}

function serve<T>(ordered: readonly T[], cap: number, totalPending?: number): ServedZone<T> {
  // The fetched page may be capped upstream (HOME_FEED_FETCH_LIMIT); when the
  // caller knows the full pending count, the overflow reflects it rather than
  // silently understating at "fetch limit minus cap".
  const total = Math.max(ordered.length, totalPending ?? 0)
  return {
    served: ordered.slice(0, cap),
    overflowCount: Math.max(0, total - cap),
  }
}

export type SelectHomeEditionInput = {
  /** The question feed (filter 'all'): direct-sent + broadcasts + legacy. */
  feedItems: readonly FeedEditionItem[]
  /**
   * Full pending count for the direct zone (meta.active_item_count from the
   * filter:'all' first page — a whole-table count, not page-bounded). The
   * fetched feedItems page is capped, so without this the "N more →" count
   * would silently understate once the queue outgrows the fetch limit.
   */
  directPendingTotal?: number
  /** The full activity/Lately stream for the viewer. */
  activityItems: readonly StreamItem[]
  /**
   * The home discovery promos (each already null when data-absent). World
   * Expanding was sunset, so only two remain: `sharedGround` fills the mid-feed
   * panel, `growCircle` is the always-on Find Friends interlude at the tail.
   */
  promos: {
    sharedGround: StreamItem | null
    growCircle: StreamItem | null
  }
  /** Injectable clock for deterministic texture bounding in tests. */
  now?: number
}

export function selectHomeEdition(input: SelectHomeEditionInput): HomeEdition {
  const now = input.now ?? Date.now()

  // Direct ("For You") zone — broadcasts budgeted alongside direct sends (§5).
  const directOrdered = orderDirectPending(input.feedItems)
  const direct = serve(directOrdered, DIRECT_SERVE_CAP, input.directPendingTotal)

  // From Friends activity log: EVERY milestone bundle (pending OR fully answered)
  // is retained and ordered newest-first — an answered bundle stays as a spent
  // card (D-FEED-FRIEND-ACTIVITY-01 §Q4) instead of being consumed. Non-milestone
  // social events remain texture (locked Group 3 chronological treatment).
  const friendActivityPool: StreamItem[] = []
  const texturePool: StreamItem[] = []
  for (const item of input.activityItems) {
    if (isMilestoneBundle(item)) friendActivityPool.push(item)
    else texturePool.push(item)
  }

  const playables = serve(orderFriendActivity(friendActivityPool), PLAYABLE_SERVE_CAP)

  const texture = boundTexture(texturePool, now)

  // Per-section "empty this section" signal (model point 4). A Zone-2 section
  // is empty when it has zero items inside the rolling home window. The source
  // queries already window the pools to HOME_WINDOW_DAYS for the home caller;
  // we re-apply the in-window check here so the pure layer is self-consistent
  // (and so a non-windowed caller still gets an honest signal). Convergence
  // ("Shared Ground") rows currently flow through the texture pool — the band
  // restructure (-04) splits them out — so we detect them here by relationship.
  const windowFloor = now - HOME_WINDOW_DAYS * DAY_MS
  const inWindow = (item: StreamItem): boolean => ms(item.sortAt) >= windowFloor
  const emptySections = {
    fromFriends: !friendActivityPool.some(inWindow),
    texture: texture.length === 0,
    sharedGround: !texturePool.some((item) => item.relationship === 'convergence' && inWindow(item)),
  }

  // The two-state empty switch operates on the three CONTENT zones only.
  // Direct uses the full pending pool (not the served slice) so a page that is
  // merely over-budget never reads as empty.
  const isAllEmpty =
    directOrdered.length === 0 && friendActivityPool.length === 0 && texture.length === 0

  // The mid-feed panel is the Overlap ("Shared Ground") interlude; the all-empty
  // page gets no panel (the empty state already carries the one invitation, §9).
  const panel = isAllEmpty ? null : input.promos.sharedGround
  // Grow Your Circle is always-on (rendered at the feed tail above the Write
  // composer), so it surfaces every load rather than competing for the panel.
  const growCircle = input.promos.growCircle

  return { direct, playables, texture, panel, growCircle, isAllEmpty, emptySections }
}
