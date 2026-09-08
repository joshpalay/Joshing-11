import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AcceptFriendInvitationButton } from '@/components/invite/AcceptFriendInvitationButton';
import {
  InvitationLandingContent,
  InvitationPageShell,
} from '@/components/invite/InvitationLanding';
import { inviteAcceptanceLabel, safeInviteName } from '@/lib/invite-links';
import { getSession } from '@/server/auth/session';
import { getFriendInvitationLandingByToken } from '@/server/friends/invitations';

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

function inviteLoginHref(token: string) {
  return `/login?invitationToken=${encodeURIComponent(token)}`;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const invitation = await getFriendInvitationLandingByToken(token);
  const session = await getSession();

  if (invitation.status === 'valid') {
    if (session?.userId === invitation.inviterUserId) redirect('/friends');
    const inviterName = safeInviteName(invitation.inviterName);

    return (
      <InvitationPageShell>
        <InvitationLandingContent
          inviterName={inviterName}
          categories={invitation.categories}
          action={
            session ? (
              <AcceptFriendInvitationButton token={token} inviterName={inviterName} />
            ) : (
              <Link href={inviteLoginHref(token)} className="btn-primary min-h-11 w-full">
                {inviteAcceptanceLabel(inviterName)}
              </Link>
            )
          }
        />
      </InvitationPageShell>
    );
  }

  if (invitation.status === 'accepted') {
    return (
      <InvitationPageShell>
        <div className="space-y-4 text-center">
          <p className="text-muted-foreground text-sm font-medium">Invitation already used</p>
          <h1 className="font-serif text-3xl leading-tight font-semibold">
            This invitation has already been used.
          </h1>
          <p className="text-muted-foreground text-sm leading-6">
            Continue to Joshing with the account that accepted it.
          </p>
          <Link href={session ? '/' : '/login'} className="btn-primary min-h-11 w-full">
            {session ? 'Continue to Joshing' : 'Go to login'}
          </Link>
        </div>
      </InvitationPageShell>
    );
  }

  const expired = invitation.status === 'expired';
  return (
    <InvitationPageShell>
      <div className="space-y-4 text-center">
        <p className="text-muted-foreground text-sm font-medium">
          {expired ? 'Invitation expired' : 'Invitation unavailable'}
        </p>
        <h1 className="font-serif text-3xl leading-tight font-semibold">
          {expired ? 'This invitation has expired.' : 'This invitation link is not valid.'}
        </h1>
        <p className="text-muted-foreground text-sm leading-6">
          Ask your friend to send you a new Joshing invitation.
        </p>
        <Link href="/login" className="btn-ghost min-h-11 w-full">
          Go to login
        </Link>
      </div>
    </InvitationPageShell>
  );
}
