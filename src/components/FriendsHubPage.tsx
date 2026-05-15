'use client'

import AddFriendInvite from '@/components/AddFriendInvite'
import FriendsList from '@/components/FriendsList'

export default function FriendsHubPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5">
      <header className="mb-5 border-b pb-4">
        <p className="text-muted-foreground text-xs tracking-[0.1em] uppercase">
          Joshing
        </p>
        <h1 className="text-foreground font-serif text-3xl font-semibold">
          Friends
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Invite your people, answer warm notes, and keep your circle close.
        </p>
      </header>

      <AddFriendInvite />
      <FriendsList />
    </main>
  )
}
