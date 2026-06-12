import { redirect } from 'next/navigation'

import FeedList from '@/components/FeedList'
import { OverflowSubpageHeader } from '@/components/home/OverflowSubpageHeader'
import { getSession } from '@/server/auth/session'
import { buildPendingDirectQueue } from '@/server/home/build-edition'

// B-HOME-OVERFLOW-02 — the direct-questions overflow subpage. Renders the FULL
// pending "For You" queue (every question a friend sent or broadcast to you),
// in the same sender-rotated order Home windows its served top-3 from, and
// answerable in place via the same FeedList answer flow the home zone uses.
// Reached only from Home's "N more from friends →" row; never a nav tab.
export default async function ForYouPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const { items, meta } = await buildPendingDirectQueue(session.userId)
  // The fetch is clamped (MAX_FEED_LIMIT), but active_item_count is the
  // whole-table pending count — the title states the true abundance.
  const pendingTotal = Math.max(items.length, meta.active_item_count)

  const initialPage = {
    viewer_user_id: session.userId,
    meta,
    items,
    has_more: false,
    next_cursor: null,
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-[18px] px-4 py-6 pb-32 md:py-10">
      <OverflowSubpageHeader
        eyebrow="For You"
        title={
          pendingTotal > 0 ? `${pendingTotal} waiting for you` : 'Waiting for you'
        }
      />
      <section>
        <FeedList initialPage={initialPage} pendingQueue />
      </section>
    </main>
  )
}
