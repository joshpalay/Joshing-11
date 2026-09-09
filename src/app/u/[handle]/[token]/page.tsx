import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AcceptInviteLinkButton } from '@/components/invite/AcceptInviteLinkButton';
import {
  InvitationLandingContent,
  InvitationPageShell,
} from '@/components/invite/InvitationLanding';
import { safeInviteName } from '@/lib/invite-links';
import { getSession } from '@/server/auth/session';
import { resolveInviteLink } from '@/server/friends/user-invite-token';

type InvitePageProps = {
  params: Promise<{ handle: string; token: string }>;
};

function loginHref(handle: string, token: string): string {
  const params = new URLSearchParams({
    inviteHandle: handle,
    inviteUserToken: token,
  });
  return `/login?${params.toString()}`;
}

export default async function UserInvitePage({ params }: InvitePageProps) {
  const { handle, token } = await params;
  const inviter = await resolveInviteLink(handle, token);

  if (!inviter) {
    return (
      <InvitationPageShell>
        <div className="space-y-4 text-center">
          <p className="text-muted-foreground text-sm font-medium">Invitation unavailable</p>
          <h1 className="font-serif text-3xl leading-tight font-semibold text-balance">
            This invitation link is no longer valid.
          </h1>
          <p className="text-muted-foreground text-sm leading-6">
            Ask your friend for a fresh link, or continue to Joshing if you already have an account.
          </p>
          <Link href="/login" className="btn-ghost min-h-11 w-full">
            Go to login
          </Link>
        </div>
      </InvitationPageShell>
    );
  }

  const session = await getSession();
  if (session?.userId === inviter.inviterUserId) redirect('/friends');

  // Preserve old /u links already in circulation, but take signed-out invitees
  // directly to the invite-aware phone screen instead of adding an extra
  // acceptance screen before authentication.
  if (!session) redirect(loginHref(inviter.inviterHandle, token));

  const inviterName = safeInviteName(inviter.inviterDisplayName);

  return (
    <InvitationPageShell>
      <InvitationLandingContent
        inviterName={inviterName}
        categories={inviter.seedTopics}
        action={
          <AcceptInviteLinkButton
            handle={inviter.inviterHandle}
            token={token}
            inviterName={inviterName}
          />
        }
      />
    </InvitationPageShell>
  );
}
