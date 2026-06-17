import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getFriendInvitationLandingByToken } from '@/server/friends/invitations';

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

function inviteLoginHref(token: string) {
  return `/login?invitationToken=${encodeURIComponent(token)}`;
}

function InviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-10">
      <section className="bg-card w-full max-w-sm rounded-[var(--radius-card)] border p-5 shadow-[var(--shadow-card)]">
        {children}
      </section>
    </main>
  );
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const invitation = await getFriendInvitationLandingByToken(token);

  if (invitation.status === 'valid') {
    // Skip the interstitial — drop the invitee straight onto the login screen,
    // which carries the invite context (the reworded "verify your phone" card).
    redirect(inviteLoginHref(token));
  }

  if (invitation.status === 'expired') {
    return (
      <InviteShell>
        <div className="space-y-4 text-center">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Invitation expired
          </p>
          <h1 className="font-serif text-2xl leading-tight font-semibold">
            This invitation has expired. Ask {invitation.inviterName} to send you a new one.
          </h1>
          <Link
            href="/login"
            className="btn-ghost w-full"
          >
            Go to login
          </Link>
        </div>
      </InviteShell>
    );
  }

  if (invitation.status === 'accepted') {
    return (
      <InviteShell>
        <div className="space-y-4 text-center">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Invitation already used
          </p>
          <h1 className="font-serif text-2xl leading-tight font-semibold">
            This invitation has already been used.
          </h1>
          <p className="text-muted-foreground text-sm leading-6">
            Log in with your phone number to continue to Joshing.
          </p>
          <Link href="/login" className="btn-primary w-full">
            Go to login
          </Link>
        </div>
      </InviteShell>
    );
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
  );
}
