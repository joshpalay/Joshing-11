'use client';

import { useState } from 'react';

import AddFriendInvite from '@/components/AddFriendInvite';
import FriendsList from '@/components/FriendsList';
import { FindFriendsSearch } from '@/components/friends/FindFriendsSearch';
import { InviteSomeoneNew } from '@/components/friends/InviteSomeoneNew';
import type { QueryClassification } from '@/components/friends/add-someone';

export default function FriendsHubPage() {
  const [inviteOpen, setInviteOpen] = useState(false);

  function openInviteFlow(detail: Record<string, unknown> = {}) {
    window.dispatchEvent(new CustomEvent('friend-invitations:create-new', { detail }));
  }

  // No-match invite from the lookup. A US number seeds the SMS invite's phone
  // field; a typed name seeds the invite's Name field so it isn't retyped. A
  // handle isn't a phone (or a real name), so it opens the invite flow blank.
  function handleLookupInvite(query: string, classification: QueryClassification) {
    if (classification === 'phone') {
      openInviteFlow({ phone: query });
    } else if (classification === 'name') {
      openInviteFlow({ inviteeDisplayName: query });
    } else {
      openInviteFlow({});
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5 pb-24">
      <header className="mb-5">
        <h1 className="text-foreground font-serif text-3xl font-semibold">Friends</h1>
      </header>

      {/* Lookup field: an exact @handle/number match offers to send a friend
          request; no match (or a typed name) drops into the field's own
          "invite them" state, which expands the phone-invite flow below. */}
      <section className="border-primary/15 bg-primary/5 text-card-foreground mb-5 rounded-[var(--radius-card)] border p-6 shadow-[var(--shadow-card)]">
        {!inviteOpen ? (
          <FindFriendsSearch variant="add" onInvite={handleLookupInvite} />
        ) : null}
        <AddFriendInvite embedded onExpandedChange={setInviteOpen} />
      </section>
      {/* Standalone invite block (Stage 3, B-Friends-3): the link is the
          primary invite action, reachable from here in one tap rather than
          only via a search no-match. */}
      <div className="mb-5">
        <InviteSomeoneNew />
      </div>
      <FriendsList />
    </main>
  );
}
