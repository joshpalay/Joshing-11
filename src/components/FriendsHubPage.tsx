'use client'

import AddFriendInvite from '@/components/AddFriendInvite'
import FriendsList from '@/components/FriendsList'

function openAddFriend() {
  window.dispatchEvent(new CustomEvent('friend-invitations:create-new'))
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

export default function FriendsHubPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5">
      <header className="mb-5 flex items-start justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-muted-foreground text-xs tracking-[0.1em] uppercase">
            Joshing
          </p>
          <h1 className="text-foreground font-serif text-3xl font-semibold">
            Friends
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Invite your people, respond to requests, and keep your circle close.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary min-h-11 shrink-0 rounded-full px-5"
          onClick={openAddFriend}
        >
          Add friend
        </button>
      </header>

      <AddFriendInvite />
      <FriendsList />
    </main>
  )
}
