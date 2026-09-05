import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { ContactMatchBlock } from '@/components/friends/ContactMatchBlock'
import { FindFriendsSearch } from '@/components/friends/FindFriendsSearch'
import { InviteLinksSection } from '@/components/friends/InviteLinksSection'
import { colorForUser, formatRelativeTime } from '@/components/feed/visual'
import FriendsList from '@/components/FriendsList'
import { getSession } from '@/server/auth/session'
import { db, users } from '@/server/db'
import {
  getLastContactHashUpload,
  isRefreshDue,
  listContactMatches,
  markDiscoveryChecked,
} from '@/server/db/queries/contact-hashes'
import { listInviteReflections } from '@/server/db/queries/friend-invitations'
import { listLiveInviteLinks } from '@/server/db/queries/invite-links'
import { buildInviteUrl, getBaseUrl, getInviteLinkSeedTopics } from '@/server/friends/user-invite-token'

export const dynamic = 'force-dynamic'

function initialsFor(name: string | null, fallback: string): string {
  const source = (name?.trim() || fallback).replace(/[^a-zA-Z]+/g, ' ').trim()
  if (!source) return '??'
  const parts = source.split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export default async function FriendsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [viewer] = await db
    .select({
      handle: users.handle,
      discoverableByContacts: users.discoverableByContacts,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!viewer) redirect('/login')

  // Stamp the discovery threshold AS the user lands here — clears the
  // Nav-tab dot and the Invitations-tab passive row on next render.
  await markDiscoveryChecked(session.userId)

  const [reflections, contactMatches, lastContactUpload, resolvedTopics, liveLinks] = await Promise.all([
    listInviteReflections(session.userId),
    viewer.discoverableByContacts ? listContactMatches(session.userId) : Promise.resolve([]),
    viewer.discoverableByContacts ? getLastContactHashUpload(session.userId) : Promise.resolve(null),
    getInviteLinkSeedTopics(session.userId),
    listLiveInviteLinks(session.userId),
  ])
  const contactRefreshDue = isRefreshDue(lastContactUpload)

  const requestHeaders = await headers()
  const baseUrl = getBaseUrl(requestHeaders)
  const initialLinks = viewer.handle
    ? liveLinks.map((link) => ({
        id: link.id,
        slot: link.slot,
        url: buildInviteUrl(baseUrl, viewer.handle!, link.token),
        createdAt: link.createdAt.toISOString(),
        joinedCount: link.joinedCount,
      }))
    : []

  const hasSuggestions = contactMatches.length > 0 || reflections.length > 0

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5 pb-28">
      <header className="mb-5">
        <h1 className="text-foreground font-serif text-3xl font-semibold">Friends</h1>
      </header>

      {/* Add someone new: exact @handle / phone lookup, plus contact sync where
          the browser supports it. No section heading -- the card carries its own,
          and a heading over a single card was pure vertical cost. */}
      <div className="mb-5 space-y-3">
        <FindFriendsSearch />
        <ContactMatchBlock
          discoverableByContacts={viewer.discoverableByContacts}
          initialMatches={contactMatches.map((match) => ({
            id: match.id,
            handle: match.handle,
            displayName: match.displayName,
            avatarColor: match.avatarColor,
            createdAt: match.createdAt.toISOString(),
            relationship: match.relationship,
          }))}
          initialRefreshDue={contactRefreshDue}
        />
      </div>

      {/* Suggested: passive scanning. Every row carries a provenance chip so a
          suggestion never reads as unexplained.

          Rendered ONLY when it has people in it -- heading included. Previously
          the heading always rendered, so with no contact matches and no invite
          reflections the whole section was a title over a "Coming soon" card:
          roughly a third of the first screen saying nothing. An empty section
          should be absent, not empty. */}
      {hasSuggestions ? (
        <section className="mb-5 space-y-3">
          <h2 className="text-foreground font-serif text-xl font-semibold">Suggested</h2>
          <div className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]">
            {reflections.map((reflection) => {
              const displayName = reflection.displayName?.trim() || `@${reflection.handle ?? ''}`
              const initials = initialsFor(reflection.displayName, reflection.handle ?? '?')
              const swatch = reflection.avatarColor || colorForUser(reflection.inviteeUserId)
              return (
                <article key={reflection.invitationId} className="flex items-start gap-3 border-b py-3 last:border-0 last:pb-0">
                  <span
                    aria-hidden
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                    style={{ background: swatch }}
                  >
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-foreground font-medium">{displayName}</h3>
                    <span className="text-muted-foreground bg-secondary mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
                      Joined from your invite
                    </span>
                    <p className="text-muted-foreground/70 mt-1 text-xs">
                      invited {formatRelativeTime(reflection.invitedAt.toISOString())} · joined{' '}
                      {formatRelativeTime(reflection.joinedAt.toISOString())}
                    </p>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* Invite via link. An action rather than a destination, so it sits above
          the roster but below the lookup. */}
      <div className="mb-5">
        <InviteLinksSection initialTopics={resolvedTopics} initialLinks={initialLinks} />
      </div>

      {/* The roster is what people come back for, so it moves up: with the dead
          contact card and the empty Suggested section gone, it now starts on the
          first screen instead of the third. */}
      <FriendsList />
    </main>
  )
}
