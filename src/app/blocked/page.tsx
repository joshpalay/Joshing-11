import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BlockedList } from '@/components/blocked/BlockedList'
import { getSession } from '@/server/auth/session'
import { listBlockedUsers } from '@/server/db/queries/user-blocks'

// B-FRIENDS-SAFETY-01 Phase 1 — "Blocked people" list in privacy settings.
// The only place a block can be undone (the target's own profile becomes
// unreachable once blocked, so unblocking can't happen from there).
export const dynamic = 'force-dynamic'

export default async function BlockedPeoplePage() {
  const session = await getSession()
  if (!session) notFound()

  const blocked = await listBlockedUsers(session.userId)

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5 pb-28">
      <div className="mb-5">
        <Link
          href="/users/me"
          className="text-muted-foreground text-sm font-medium underline-offset-4 hover:underline"
        >
          ← Profile
        </Link>
      </div>
      <h1 className="text-foreground font-serif text-2xl font-semibold">Blocked people</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm leading-6">
        People you&apos;ve blocked can&apos;t see your profile, follow you, or find you in
        search. Unblocking doesn&apos;t restore any connection you had before.
      </p>
      <BlockedList
        initialItems={blocked.map((item) => ({
          id: item.id,
          handle: item.handle,
          displayName: item.displayName,
          avatarColor: item.avatarColor,
        }))}
      />
    </main>
  )
}
