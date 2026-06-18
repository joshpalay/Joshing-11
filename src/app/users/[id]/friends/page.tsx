import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getSession } from '@/server/auth/session'
import { getFriends } from '@/server/db/queries/friends'
import { getFriendPortraitData } from '@/server/profile/friend'

type FriendFriendsPageProps = {
  params: Promise<{ id: string }>
}

function firstName(displayName: string): string {
  const trimmed = displayName.trim()
  if (!trimmed) return 'They'
  const [first] = trimmed.split(/\s+/)
  return first ?? trimmed
}

export const dynamic = 'force-dynamic'

// Full list of a user's friends, linked from the "Friends" module on their
// profile dashboard. Gated by the viewed user's friends_list visibility — the
// same gate the dashboard module uses — so a hidden friends list 404s here too.
export default async function FriendFriendsPage({ params }: FriendFriendsPageProps) {
  const session = await getSession()
  if (!session) notFound()

  const { id } = await params
  const portrait = await getFriendPortraitData(id, session.userId)
  if (!portrait) notFound()
  if (portrait.visibility === 'stranger') notFound()
  if (!portrait.sectionVisibleTo.friends_list) notFound()

  const friends = (await getFriends(portrait.user.id)).map((friend) => ({
    id: friend.id,
    displayName: friend.displayName?.trim() || 'Joshing friend',
  }))
  const friendFirstName = firstName(portrait.user.displayName)

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5">
      <div className="mb-5">
        <Link
          href={`/users/${portrait.user.id}`}
          className="text-muted-foreground text-sm font-medium underline-offset-4 hover:underline"
        >
          &larr; {friendFirstName}&rsquo;s profile
        </Link>
      </div>

      <header className="mb-5">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
          Friends
        </p>
        <h1 className="mt-1 font-serif text-3xl font-semibold">
          {friendFirstName}&rsquo;s friends
        </h1>
      </header>

      {friends.length === 0 ? (
        <p className="text-muted-foreground bg-muted rounded-xl px-3 py-2 text-sm">
          {friendFirstName} hasn&rsquo;t added any friends yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--brand-rule)]">
          {friends.map((friend) => (
            <li key={friend.id}>
              <Link
                href={`/users/${friend.id}`}
                className="hover:bg-muted/60 flex items-center gap-3 rounded-lg px-2 py-3"
              >
                <span className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-serif text-lg font-semibold">
                  {friend.displayName.slice(0, 1).toUpperCase() || 'J'}
                </span>
                <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                  {friend.displayName}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
