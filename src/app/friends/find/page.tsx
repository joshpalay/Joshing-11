import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import AddFriendInvite from '@/components/AddFriendInvite'
import { AddFriendButton } from '@/components/friends/AddFriendButton'
import { FindFriendsSearch } from '@/components/friends/FindFriendsSearch'
import { InviteSomeoneNew } from '@/components/friends/InviteSomeoneNew'
import { colorForUser, formatRelativeTime } from '@/components/feed/visual'
import { getSession } from '@/server/auth/session'
import { listInviteReflections } from '@/server/db/queries/friend-invitations'
import { db, users } from '@/server/db'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

function initialsFor(name: string | null, fallback: string): string {
  const source = (name?.trim() || fallback).replace(/[^a-zA-Z]+/g, ' ').trim()
  if (!source) return '??'
  const parts = source.split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export default async function FindFriendsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [viewer] = await db
    .select({
      discoverableByMutualFriends: users.discoverableByMutualFriends,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!viewer) redirect('/login')

  const reflections = await listInviteReflections(session.userId)

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pt-10 pb-28">
      <Link
        href="/friends"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back
      </Link>
      <h1 className="mt-6 font-serif text-3xl font-semibold leading-tight">
        Find friends
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Search for someone, see who you&rsquo;ve nudged, or invite a friend.
      </p>

      <div className="mt-6 space-y-5">
        {/* Block 1 — Search by handle or phone */}
        <FindFriendsSearch />

        {/* Block 2 — Contact matches (placeholder; B-Friends-4 replaces) */}
        <section className="bg-card text-card-foreground rounded-2xl border p-4 shadow-sm">
          <h2 className="font-serif text-lg font-semibold">
            Find friends already on Joshing
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            We can check which of your phone contacts are here. We never share your contacts.
          </p>
          <button
            type="button"
            disabled
            title="Coming soon."
            aria-disabled
            className="bg-muted text-muted-foreground mt-3 inline-flex h-11 cursor-not-allowed items-center justify-center rounded-full px-4 text-sm opacity-60"
          >
            Match my contacts
          </button>
        </section>

        {/* Block 3 — Existing-invite reflection */}
        {reflections.length > 0 ? (
          <section className="bg-card text-card-foreground rounded-2xl border p-4 shadow-sm">
            <h2 className="font-serif text-lg font-semibold">
              People you invited
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              They showed up. Want to make it official?
            </p>
            <div className="mt-3 space-y-3">
              {reflections.map((reflection) => {
                const displayName = reflection.displayName?.trim() || `@${reflection.handle ?? ''}`
                const initials = initialsFor(reflection.displayName, reflection.handle ?? '?')
                const swatch = reflection.avatarColor || colorForUser(reflection.inviteeUserId)
                return (
                  <article
                    key={reflection.invitationId}
                    className="bg-background flex items-start gap-3 rounded-xl border p-3"
                  >
                    <span
                      aria-hidden
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                      style={{ background: swatch }}
                    >
                      {initials}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-foreground font-medium">{displayName}</h3>
                      <p className="text-muted-foreground/70 mt-1 text-xs">
                        invited {formatRelativeTime(reflection.invitedAt.toISOString())}{' '}
                        · joined {formatRelativeTime(reflection.joinedAt.toISOString())}
                      </p>
                    </div>
                    <AddFriendButton
                      targetUserId={reflection.inviteeUserId}
                      targetDisplayName={displayName}
                      relationship={reflection.relationship}
                    />
                  </article>
                )
              })}
            </div>
          </section>
        ) : null}

        {/* Block 4 — Invite someone new */}
        <InviteSomeoneNew />

        {/* Block 5 — Suggested via mutual friends (placeholder; hidden when opted out) */}
        {viewer.discoverableByMutualFriends ? (
          <section className="bg-card text-card-foreground rounded-2xl border p-4 shadow-sm">
            <h2 className="font-serif text-lg font-semibold">
              Suggested via mutual friends
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Coming soon — suggestions from people you have friends in common with.
            </p>
          </section>
        ) : null}
      </div>

      {/* Listener for the 'Send a personal invite' button — AddFriendInvite
          subscribes to the friend-invitations:create-new event and opens its
          3-step modal. Must be mounted here so the event has a listener. */}
      <AddFriendInvite />
    </main>
  )
}
