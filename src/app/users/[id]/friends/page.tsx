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
        <p className="text-muted-foreground text-xs font-medium tracking-eyebrow uppercase">
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
        <ul className="border-border mt-1 divide-y rounded-md border">
          {friends.map((friend) => (
            <li key={friend.id}>
              <Link
                href={`/users/${friend.id}`}
                className="hover:bg-secondary/40 flex items-center justify-between px-4 py-3 text-sm font-medium transition-colors"
              >
                <span className="min-w-0 truncate">{friend.displayName}</span>
                <span aria-hidden="true" className="text-muted-foreground">
                  &rarr;
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
