import { Chip } from '@/components/ui/Chip'

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
            <Chip href={`/users/${friend.id}`} className="bg-secondary text-secondary-foreground hover:bg-secondary/80">
              {friend.displayName}
            </Chip>
          </li>
        ))}
        {overflowCount > 0 ? (
          <li>
            <Chip className="text-muted-foreground">+{overflowCount} more</Chip>
          </li>
        ) : null}
      </ul>
    </section>
  )
}
