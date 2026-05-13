import type { ReactNode } from 'react'
import Link from 'next/link'

import { getFriendInvitationLandingByToken } from '@/server/friends/invitations'

type InvitePageProps = {
  params: Promise<{ token: string }>
}

function inviteLoginHref(token: string) {
  return `/login?invitationToken=${encodeURIComponent(token)}`
}

function InviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-10">
      <section className="bg-card w-full max-w-sm rounded-lg border p-5 shadow-sm">
        {children}
      </section>
    </main>
  )
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params
  const invitation = await getFriendInvitationLandingByToken(token)

  if (invitation.status === 'valid') {
    return (
      <InviteShell>
        <div className="space-y-5">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Friend invite
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">
              {invitation.inviterName} invited you to Joshing.
            </h1>
          </div>

          {invitation.suggestedInterests.length > 0 ? (
            <div className="bg-background/60 space-y-3 rounded-lg border p-4">
              <p className="text-sm leading-6 font-medium">
                They thought you might like questions about:
              </p>
              <div className="flex flex-wrap gap-2">
                {invitation.suggestedInterests.map((interest) => (
                  <span
                    key={interest.label}
                    className="bg-card text-foreground rounded-full border px-3 py-1 text-sm shadow-sm"
                  >
                    {interest.label}
                  </span>
                ))}
              </div>
              <p className="text-muted-foreground text-sm">
                You can change these.
              </p>
            </div>
          ) : null}

          <Link
            href={inviteLoginHref(token)}
            className="bg-primary text-primary-foreground inline-flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-medium"
          >
            Continue
          </Link>
        </div>
      </InviteShell>
    )
  }

  if (invitation.status === 'expired') {
    return (
      <InviteShell>
        <div className="space-y-4 text-center">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Invitation expired
          </p>
          <h1 className="text-2xl font-semibold tracking-normal">
            This invitation has expired. Ask {invitation.inviterName} to send
            you a new one.
          </h1>
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

  if (invitation.status === 'accepted') {
    return (
      <InviteShell>
        <div className="space-y-4 text-center">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Invitation already used
          </p>
          <h1 className="text-2xl font-semibold tracking-normal">
            This invitation has already been used.
          </h1>
          <p className="text-muted-foreground text-sm leading-6">
            Log in with your phone number to continue to Joshing.
          </p>
          <Link
            href="/login"
            className="bg-primary text-primary-foreground inline-flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-medium"
          >
            Go to login
          </Link>
        </div>
      </InviteShell>
    )
  }

  return (
    <InviteShell>
      <div className="space-y-4 text-center">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Invalid invitation
        </p>
        <h1 className="text-2xl font-semibold tracking-normal">
          This invitation link is not valid.
        </h1>
        <p className="text-muted-foreground text-sm leading-6">
          Ask your friend to send you a new Joshing invitation.
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
