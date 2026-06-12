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
   * Playable friend activity — answerable milestone bundles. Cap 4, actor-
   * interleaved so one chatty friend can't hold consecutive slots (§5).
   */
  playables: ServedZone<StreamItem>
  /**
   * Texture — chronological full-sentence lone social events (locked Group 3),
   * newest-first, today-and-yesterday preferred with older backfill, soft-
   * capped (~8). No overflow subpage.
   */
  texture: StreamItem[]
  /** Exactly one rotating panel per load; null on the all-empty page (§9). */
  panel: StreamItem | null
  /**
   * True when all three CONTENT zones are empty (§9). Hero and composer are
   * never counted. Drives the two-state empty switch: when true, Home renders
   * the existing empty state inline and suppresses the panel.
   */
  isAllEmpty: boolean
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
 * §2 slot 4 / §4 — texture prefers today-and-yesterday (a rolling 48-hour
 * window from `now` is the timezone-agnostic proxy). Tuned 2026-06-12: when
 * the fresh window can't fill the soft cap, older moments backfill —
 * newest-first — so a quiet stretch doesn't leave the zone threadbare. The
 * cap, not the window, bounds the page.
 */
export function boundTexture(
  items: readonly StreamItem[],
  now: number,
  cap = TEXTURE_SOFT_CAP,
): StreamItem[] {
  const floor = now - 2 * DAY_MS
  const sorted = [...items].sort((a, b) => ms(b.sortAt) - ms(a.sortAt))
  const fresh = sorted.filter((item) => ms(item.sortAt) >= floor)
  if (fresh.length >= cap) return fresh.slice(0, cap)
  return [...fresh, ...sorted.filter((item) => ms(item.sortAt) < floor)].slice(0, cap)
}

/**
 * One panel per load (§2 slot 5). Each promo is already data-gated upstream
 * (null when its data is absent — e.g. no shared ground for a user with no
 * overlap), so this only chooses among the present ones. Quiet pages bias to
 * Grow Your Circle; otherwise Shared Ground > World Expanding > Grow Your
 * Circle. Suppressed entirely on the all-empty page (handled by the caller).
 */
export function selectPanel(
  promos: {
    sharedGround: StreamItem | null
    expanding: StreamItem | null
    growCircle: StreamItem | null
  },
  isQuiet: boolean,
): StreamItem | null {
  const { sharedGround, expanding, growCircle } = promos
  if (isQuiet && growCircle) return growCircle
  return sharedGround ?? expanding ?? growCircle ?? null
}

/** A milestone bundle (≥1 question), pending or fully spent. */
function isMilestoneBundle(item: StreamItem): boolean {
  return item.expand?.kind === 'milestone' && item.expand.questions.length > 0
}

/**
 * §7 pending definition: a bundle is PENDING only while the viewer still has at
 * least one unanswered question in it. build-stream keeps answered questions in
 * the bundle (they render as spent triangles), so questions.length alone would
 * keep a fully-played bundle in the queue forever — holding a served slot,
 * inflating the "N more →" count, and never leaving the overflow subpage.
 * Shared by Home, the overflow counts, and the pending-playables subpage so the
 * three views can't disagree about what "pending" means.
 */
export function isPendingPlayable(item: StreamItem): boolean {
  return (
    item.expand?.kind === 'milestone' &&
    item.expand.questions.some((q) => !q.priorResult)
  )
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
 * §5 zone order for the pending-playables queue — filters to pending bundles
 * (see isPendingPlayable) and actor-interleaves. Home serves the top 4 of this;
 * the /from-friends subpage renders all of it.
 */
export function orderPendingPlayables(
  items: readonly StreamItem[],
): StreamItem[] {
  return interleaveByActor(
    items.filter(isPendingPlayable),
    (item) => item.friendId ?? null,
    playableType,
  )
}

/** Event-type key for the playable interleave's degenerate-case variety. */
function playableType(item: StreamItem): string {
  return item.relationship ?? item.expand?.kind ?? 'milestone'
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
  /** The three home discovery promos (each already null when data-absent). */
  promos: {
    sharedGround: StreamItem | null
    expanding: StreamItem | null
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

  // Split the activity stream into pending playables (answerable milestone
  // bundles with ≥1 unanswered question), texture (everything else non-feed),
  // and consumed bundles. A fully-answered bundle is consumed: it is no longer
  // pending (§7 — it left the queue) and it is not a texture moment either (the
  // archive surfaces own anything cumulative), so it drops from the edition.
  const playablePool: StreamItem[] = []
  const texturePool: StreamItem[] = []
  for (const item of input.activityItems) {
    if (isMilestoneBundle(item)) {
      if (isPendingPlayable(item)) playablePool.push(item)
    } else {
      texturePool.push(item)
    }
  }

  const playables = serve(orderPendingPlayables(playablePool), PLAYABLE_SERVE_CAP)

  const texture = boundTexture(texturePool, now)

  // The two-state empty switch operates on the three CONTENT zones only.
  // Direct uses the full pending pool (not the served slice) so a page that is
  // merely over-budget never reads as empty.
  const isAllEmpty =
    directOrdered.length === 0 && playablePool.length === 0 && texture.length === 0

  // A quiet page biases the panel to Grow Your Circle; the all-empty page gets
  // no panel (the empty state already carries the one invitation, §9).
  const isQuiet = playablePool.length + texturePool.length <= 2
  const panel = isAllEmpty ? null : selectPanel(input.promos, isQuiet)

  return { direct, playables, texture, panel, isAllEmpty }
}
