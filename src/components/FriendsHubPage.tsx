'use client';

import { useState } from 'react';

import AddFriendInvite from '@/components/AddFriendInvite';
import FriendsList from '@/components/FriendsList';

export default function FriendsHubPage() {
  const [inviteOpen, setInviteOpen] = useState(false);

  function openInviteFlow() {
    window.dispatchEvent(new CustomEvent('friend-invitations:create-new', { detail: {} }));
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5 pb-24">
      <header className="mb-5">
        <h1 className="text-foreground font-serif text-3xl font-semibold">Friends</h1>
      </header>

      <section className="border-primary/15 bg-primary/5 text-card-foreground mb-5 rounded-[2rem] border p-6 shadow-sm">
        {!inviteOpen ? (
          <>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
              Invite
            </p>
            <h2 className="text-foreground mt-3 font-serif text-3xl leading-tight font-semibold">
              Who shares your world?
            </h2>
            <p className="text-muted-foreground mt-3 text-base leading-7">
              Invite someone who would enjoy the questions and discoveries happening here.
            </p>
            <button
              type="button"
              className="btn-primary mt-5 min-h-12 w-full rounded-full px-5 text-base sm:w-auto"
              onClick={openInviteFlow}
            >
              Invite Someone
            </button>
          </>
        ) : null}
        <AddFriendInvite embedded onExpandedChange={setInviteOpen} />
      </section>
      <FriendsList />
    </main>
  );
}
