/**
 * Server assembler for the Home edition (D-HOME-PACING-01).
 *
 * Runs the same upstream queries the Home page already ran inline — the question
 * feed, the activity/Lately stream, and the three discovery promos — and feeds
 * them into the pure `selectHomeEdition` budget layer. The page renders the
 * returned edition (served slices + overflow counts + bounded texture + one
 * panel) instead of the unbounded zones.
 *
 * `feedMeta` is returned alongside the edition so the page can seed <FeedList />
 * with the same meta (has_friends, the per-surface counts) the empty-state copy
 * and surface tabs read from.
 */

import type { StreamItem } from '@/lib/activity-stream'
import { buildActivityStream } from '@/server/activity/build-stream'
import { getAddFriendsPromo } from '@/server/activity/add-friends-promo'
import { getCommonGroundPromo } from '@/server/activity/common-ground-promo'
import { getRecentlyExpandingPromo } from '@/server/activity/recently-expanding-promo'
import { getFeedPagePayload } from '@/server/feed/get-feed-page'
import {
  orderDirectPending,
  orderFriendActivity,
  selectHomeEdition,
  type HomeEdition,
} from '@/server/home/select-edition'

// The home feed leads with a deep first page; the budget then windows it down to
// the served caps. Keep this generous so the pending pools (and therefore the
// overflow counts) are accurate rather than truncated by the page size.
const HOME_FEED_FETCH_LIMIT = 30

// The overflow subpages render the FULL pending queue, so they fetch deeper
// than the home edition does. getFeedForUser clamps to MAX_FEED_LIMIT (50), so
// this is the true ceiling — anything beyond it is pathological volume, and
// the subpage title still reports the accurate total from meta.
const PENDING_QUEUE_FETCH_LIMIT = 50

// The weekly reflection has its own editorial marker (CeremonyPin) above the
// feed; drop the redundant 'ceremony_ready' activity so it doesn't double up
// on the home surfaces. Shared by the home edition and the overflow subpages
// so both read the same activity pool.
function isHomeActivityItem(item: StreamItem): boolean {
  return !(item.action?.kind === 'link' && item.action.href.startsWith('/ceremony/'))
}

export type HomeEditionResult = {
  edition: HomeEdition
  feedMeta: Awaited<ReturnType<typeof getFeedPagePayload>>['meta']
}

export async function buildHomeEdition(userId: string): Promise<HomeEditionResult> {
  const [feedPage, activityItems, commonGroundPromo, expandingPromo, addFriendsPromo] =
    await Promise.all([
      getFeedPagePayload(userId, { limit: HOME_FEED_FETCH_LIMIT, cursor: null, filter: 'all' }),
      buildActivityStream(userId),
      getCommonGroundPromo(userId),
      getRecentlyExpandingPromo(userId),
      getAddFriendsPromo(userId),
    ])

  const homeActivityItems = activityItems.filter(isHomeActivityItem)

  const edition = selectHomeEdition({
    feedItems: feedPage.items,
    // Whole-table pending count for the direct zone, so the "N more →" count
    // stays accurate even when the queue outgrows HOME_FEED_FETCH_LIMIT.
    directPendingTotal: feedPage.meta.active_item_count,
    activityItems: homeActivityItems,
    promos: {
      sharedGround: commonGroundPromo,
      expanding: expandingPromo,
      growCircle: addFriendsPromo,
    },
  })

  return { edition, feedMeta: feedPage.meta }
}

/**
 * B-HOME-OVERFLOW-02 §7 — the full pending direct ("For You") queue, in the
 * same sender-rotated order the home edition windows. Home shows the top 3 of
 * exactly this list; the /for-you subpage renders all of it. Pending semantics
 * live in the feed query itself (active/skipped only — answering anywhere
 * flips the row to 'answered' and it leaves this list on the next read).
 */
export async function buildPendingDirectQueue(userId: string): Promise<{
  items: ReturnType<typeof orderDirectPending>
  meta: Awaited<ReturnType<typeof getFeedPagePayload>>['meta']
}> {
  const page = await getFeedPagePayload(userId, {
    limit: PENDING_QUEUE_FETCH_LIMIT,
    cursor: null,
    filter: 'all',
  })
  return { items: orderDirectPending(page.items), meta: page.meta }
}

/**
 * The full From Friends activity log, newest-first, in the same order the home
 * edition windows. Home shows the top 4; the /from-friends subpage renders all
 * of it. Every milestone bundle is retained — an answered bundle stays as a
 * spent card and drifts down by recency rather than leaving the surface
 * (D-FEED-FRIEND-ACTIVITY-01 §Q4).
 */
export async function buildFriendActivityQueue(userId: string): Promise<StreamItem[]> {
  const activityItems = await buildActivityStream(userId)
  return orderFriendActivity(activityItems.filter(isHomeActivityItem))
}
