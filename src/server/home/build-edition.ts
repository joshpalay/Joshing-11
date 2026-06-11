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

import { buildActivityStream } from '@/server/activity/build-stream'
import { getAddFriendsPromo } from '@/server/activity/add-friends-promo'
import { getCommonGroundPromo } from '@/server/activity/common-ground-promo'
import { getRecentlyExpandingPromo } from '@/server/activity/recently-expanding-promo'
import { getFeedPagePayload } from '@/server/feed/get-feed-page'
import { selectHomeEdition, type HomeEdition } from '@/server/home/select-edition'

// The home feed leads with a deep first page; the budget then windows it down to
// the served caps. Keep this generous so the pending pools (and therefore the
// overflow counts) are accurate rather than truncated by the page size.
const HOME_FEED_FETCH_LIMIT = 30

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

  // The weekly reflection has its own editorial marker (CeremonyPin) above the
  // feed; drop the redundant 'ceremony_ready' activity so it doesn't double up
  // in the home stream. (Unchanged from the prior inline assembly.)
  const homeActivityItems = activityItems.filter(
    (item) => !(item.action?.kind === 'link' && item.action.href.startsWith('/ceremony/')),
  )

  const edition = selectHomeEdition({
    feedItems: feedPage.items,
    activityItems: homeActivityItems,
    promos: {
      sharedGround: commonGroundPromo,
      expanding: expandingPromo,
      growCircle: addFriendsPromo,
    },
  })

  return { edition, feedMeta: feedPage.meta }
}
