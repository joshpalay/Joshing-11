import Link from 'next/link'

type MutualFriend = {
  id: string
  displayName: string
}

type MutualFriendsSectionProps = {
  friends: MutualFriend[]
  overflowCount: number
  visibility: 'friend' | 'stranger'
  friendFirstName: string
}

export function MutualFriendsSection({
  friends,
  overflowCount,
  visibility,
  friendFirstName,
}: MutualFriendsSectionProps) {
  if (friends.length === 0) {
    if (visibility === 'friend') return null
    return (
      <section className="mt-5" aria-label="Mutual friends">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
          Mutual friends
        </p>
        <p className="text-muted-foreground mt-2 text-sm">
          No mutual friends yet.
        </p>
      </section>
    )
  }

  const heading =
    visibility === 'stranger'
      ? `You both know`
      : `Friends you and ${friendFirstName} share`

  return (
    <section className="mt-5" aria-label="Mutual friends">
      <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
        Mutual friends
      </p>
      <h2 className="mt-1 font-serif text-xl font-semibold">{heading}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {friends.map((friend) => (
          <li key={friend.id}>
            <Link
              href={`/users/${friend.id}`}
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80 inline-flex items-center rounded-full px-3 py-1 text-sm font-medium"
            >
              {friend.displayName}
            </Link>
          </li>
        ))}
        {overflowCount > 0 ? (
          <li>
            <span className="text-muted-foreground inline-flex items-center rounded-full px-3 py-1 text-sm">
              +{overflowCount} more
            </span>
          </li>
        ) : null}
      </ul>
    </section>
  )
}
