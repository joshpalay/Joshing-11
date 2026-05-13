import AddFriendInvite from '@/components/AddFriendInvite'
import FeedList from '@/components/FeedList'

export default function FeedPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5">
      <header className="mb-5 border-b pb-4">
        <p className="text-muted-foreground text-xs tracking-[0.1em] uppercase">
          Joshing
        </p>
        <h1 className="text-foreground font-serif text-2xl font-semibold">
          Feed
        </h1>
      </header>

      <AddFriendInvite />
      <FeedList />
    </main>
  )
}
