import { redirect } from 'next/navigation'

import { OverflowSubpageHeader } from '@/components/home/OverflowSubpageHeader'
import { getSession } from '@/server/auth/session'
import { buildPendingPlayablesQueue } from '@/server/home/build-edition'

import { PendingPlayablesList } from './PendingPlayablesList'

// B-HOME-OVERFLOW-02 — the pending-playables overflow subpage. Renders the
// FULL pending playable queue (friends' answerable milestone bundles with at
// least one question left to play), in the same actor-interleaved order Home
// windows its served top-4 from. Lighter ambient register than /for-you — the
// bundles keep the exact rendering the home zone already uses. Reached only
// from Home's "N more →" row; never a nav tab.
export default async function FromFriendsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const items = await buildPendingPlayablesQueue(session.userId)

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-[18px] px-4 py-6 pb-32 md:py-10">
      <OverflowSubpageHeader
        eyebrow="From Friends"
        title={items.length > 0 ? `${items.length} more to play` : 'More to play'}
      />
      {items.length === 0 ? (
        <p className="font-serif text-lg font-medium text-[var(--brand-ink)]">
          You are all caught up!
        </p>
      ) : (
        <PendingPlayablesList items={items} />
      )}
    </main>
  )
}
