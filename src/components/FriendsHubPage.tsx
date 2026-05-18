'use client'

import AddFriendInvite from '@/components/AddFriendInvite'
import FriendsList from '@/components/FriendsList'

export default function FriendsHubPage() {
  function openAddFriend() {
    window.dispatchEvent(
      new CustomEvent('friend-invitations:create-new', { detail: {} })
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5">
      <header className="mb-5 flex items-center justify-between gap-4 border-b pb-4">
        <h1 className="text-foreground font-serif text-3xl font-semibold">
          Friends
        </h1>
        <button
          type="button"
          className="btn-primary min-h-10 shrink-0 rounded-full px-4 text-sm"
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
