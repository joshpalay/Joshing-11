import { redirect } from 'next/navigation'

import { OverflowSubpageHeader } from '@/components/home/OverflowSubpageHeader'
import { getSession } from '@/server/auth/session'
import { buildFriendActivityQueue } from '@/server/home/build-edition'

import { PendingPlayablesList } from './PendingPlayablesList'

// B-HOME-OVERFLOW-02 — the From Friends overflow subpage. Renders the FULL
// chronological friend-activity log (every milestone bundle, pending OR already
// answered), newest-first, the same order Home windows its served top-4 from.
// Answered bundles stay as spent cards (D-FEED-FRIEND-ACTIVITY-01 §Q4). Lighter
// ambient register than /for-you — the bundles keep the exact rendering the home
// zone already uses. Reached only from Home's "N more →" row; never a nav tab.
export default async function FromFriendsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const items = await buildFriendActivityQueue(session.userId)

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-6 pb-32 md:py-10">
      <OverflowSubpageHeader
        eyebrow="From Friends"
        title={items.length > 0 ? `${items.length} from friends` : 'From friends'}
      />
      {items.length === 0 ? (
        <p className="font-serif text-lg font-medium text-[var(--brand-ink)]">
          Nothing from friends yet.
        </p>
      ) : (
        <PendingPlayablesList items={items} />
      )}
    </main>
  )
}
