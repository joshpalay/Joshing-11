import type { ReactNode } from 'react';
import Link from 'next/link';

import { AvatarChip } from '@/components/AvatarChip';
import { getFriendInvitationLandingByToken } from '@/server/friends/invitations';

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

function inviteLoginHref(token: string) {
  return `/login?invitationToken=${encodeURIComponent(token)}`;
}

function InviterIdentity({
  name,
  userId,
  avatarColor,
}: {
  name: string;
  userId: string | null;
  avatarColor: string | null;
}) {
  if (!userId) return null;

  return (
    <div className="mb-4 flex items-center gap-3">
      <AvatarChip displayName={name} userId={userId} color={avatarColor} size="lg" />
      <span className="text-sm font-semibold">{name}</span>
    </div>
  );
}

function InviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-10">
      <section className="bg-card w-full max-w-sm rounded-2xl border p-5 shadow-sm">
        {children}
      </section>
    </main>
  );
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const invitation = await getFriendInvitationLandingByToken(token);

  if (invitation.status === 'valid') {
    return (
      <InviteShell>
        <div className="space-y-5">
          <div>
            <InviterIdentity
              name={invitation.inviterName}
              userId={invitation.inviterUserId}
              avatarColor={invitation.inviterAvatarColor}
            />
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              A friend thought of you
            </p>
            <h1 className="mt-2 font-serif text-3xl leading-tight font-semibold">
              {invitation.inviterName} thought of you for Joshing.
            </h1>
          </div>

          <Link
            href={inviteLoginHref(token)}
            className="bg-primary text-primary-foreground inline-flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-medium"
          >
            Continue to Joshing
          </Link>
        </div>
      </InviteShell>
    );
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
            className="inline-flex h-11 w-full items-center justify-center rounded-md border px-4 text-sm font-medium"
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
          <Link
            href="/login"
            className="bg-primary text-primary-foreground inline-flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-medium"
          >
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
