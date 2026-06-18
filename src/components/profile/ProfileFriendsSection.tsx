import Link from 'next/link'

type ProfileFriend = {
  id: string
  displayName: string
}

type ProfileFriendsSectionProps = {
  // The viewed user's friends. The page passes the full list; this component
  // renders at most `limit` chips and surfaces the rest via the view-all link.
  friends: ProfileFriend[]
  friendFirstName: string
  // Destination for the full friends list (e.g. /users/[id]/friends).
  viewAllHref: string
  // Preview cap. Defaults to 5.
  limit?: number
}

// The "Friends" module on a friend's profile dashboard: a capped preview of
// who they're friends with, with a link to the full list. Only rendered when
// the viewed user's friends_list visibility permits it (gated by the page).
export function ProfileFriendsSection({
  friends,
  friendFirstName,
  viewAllHref,
  limit = 5,
}: ProfileFriendsSectionProps) {
  const shown = friends.slice(0, limit)
  const hasMore = friends.length > shown.length

  return (
    <section className="mt-5" aria-label="Friends">
      <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
        Friends
      </p>
      <h2 className="mt-1 font-serif text-2xl font-semibold">
        {friendFirstName}&rsquo;s friends
      </h2>

      {shown.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {friendFirstName} hasn&rsquo;t added any friends yet.
        </p>
      ) : (
        <>
          <ul className="mt-3 flex flex-wrap gap-2">
            {shown.map((friend) => (
              <li key={friend.id}>
                <Link
                  href={`/users/${friend.id}`}
                  className="bg-secondary text-secondary-foreground hover:bg-secondary/80 inline-flex items-center rounded-full px-3 py-1 text-sm font-medium"
                >
                  {friend.displayName}
                </Link>
              </li>
            ))}
          </ul>
          {hasMore ? (
            <Link
              href={viewAllHref}
              className="mt-3 inline-flex text-sm font-semibold text-[var(--warm-ink)] underline-offset-4 hover:underline"
            >
              View all {friends.length} friends &rarr;
            </Link>
          ) : null}
        </>
      )}
    </section>
  )
}
