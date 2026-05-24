// Per-user invite link handler (B-Friends-3).
//
// DISTINCT from /invite/[token]/page.tsx — that route resolves a
// FriendInvitation.token (per-invitation, expires, may pre-seed interests).
// THIS route resolves the inviter's evergreen users.invite_token, generated
// on demand at /api/account/invite-token and rotatable from /account/privacy.
// Both must coexist.

import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'

import { AddFriendButton } from '@/components/friends/AddFriendButton'
import { getSession } from '@/server/auth/session'
import { getRelationship } from '@/server/db/queries/friend-requests'
import { resolveInviteLink } from '@/server/friends/user-invite-token'

type InvitePageProps = {
  params: Promise<{ handle: string; token: string }>
}

function InviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-10">
      <section className="bg-card w-full max-w-sm rounded-2xl border p-5 shadow-sm">
        {children}
      </section>
    </main>
  )
}

function loginHref(handle: string, token: string): string {
  const params = new URLSearchParams({
    inviteHandle: handle,
    inviteUserToken: token,
  })
  return `/login?${params.toString()}`
}

export default async function UserInvitePage({ params }: InvitePageProps) {
  const { handle, token } = await params
  const inviter = await resolveInviteLink(handle, token)

  if (!inviter) {
    return (
      <InviteShell>
        <div className="space-y-4 text-center">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Link not valid
          </p>
          <h1 className="text-2xl font-semibold tracking-normal">
            This invite link is no longer valid.
          </h1>
          <p className="text-muted-foreground text-sm leading-6">
            Ask your friend for a fresh link.
          </p>
          <Link
            href="/login"
            className="inline-flex h-11 w-full items-center justify-center rounded-md border px-4 text-sm font-medium"
          >
            Go to login
          </Link>
        </div>
      </InviteShell>
    )
  }

  const session = await getSession()
  const displayName = inviter.inviterDisplayName?.trim() || `@${inviter.inviterHandle}`

  // Logged-in as the inviter themselves — bounce to /friends.
  if (session?.userId === inviter.inviterUserId) {
    redirect('/friends')
  }

  // Logged-in as someone else — render an inline send-friend-request UI.
  if (session) {
    const relationship = await getRelationship(session.userId, inviter.inviterUserId)
    return (
      <InviteShell>
        <div className="space-y-5">
          <div>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              You were invited
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">
              {displayName} invited you to connect on Joshing.
            </h1>
          </div>
          <AddFriendButton
            targetUserId={inviter.inviterUserId}
            targetDisplayName={displayName}
            relationship={relationship}
          />
          <Link
            href={`/users/${inviter.inviterUserId}`}
            className="text-muted-foreground inline-flex text-sm underline underline-offset-4"
          >
            View {displayName}&rsquo;s profile
          </Link>
        </div>
      </InviteShell>
    )
  }

  // Logged-out — landing card → /login with the invite params attached.
  return (
    <InviteShell>
      <div className="space-y-5">
        <div>
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            A note from a friend
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            {displayName} invited you to Joshing.
          </h1>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            Pick up your phone — we&rsquo;ll text you a code to get started.
          </p>
        </div>
        <Link
          href={loginHref(inviter.inviterHandle, token)}
          className="bg-primary text-primary-foreground inline-flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          Continue
        </Link>
      </div>
    </InviteShell>
  )
}
