import { Suspense } from 'react';

import TriangleBackground from '@/components/TriangleBackground';
import { getInvitePrefillByToken } from '@/server/friends/invitations';
import { resolveInviteLink } from '@/server/friends/user-invite-token';

import LoginPanel from './LoginPanel';

// Mirror LoginPanel.readInvitationToken: accept any of the aliases an invite
// link may use so the prefill resolves regardless of which one routed here.
function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readInvitationToken(params: Record<string, string | string[] | undefined>): string | null {
  return (
    firstParam(params.invitationToken) ??
    firstParam(params.invite) ??
    firstParam(params.token) ??
    null
  );
}

function readUserInvite(
  params: Record<string, string | string[] | undefined>,
): { handle: string; token: string } | null {
  const handle = firstParam(params.inviteHandle);
  const token = firstParam(params.inviteUserToken);
  return handle && token ? { handle, token } : null;
}

function TitleCard() {
  return (
    <section className="w-full max-w-sm rounded-[var(--radius-md)] bg-[var(--brand-cream-card)] px-12 py-7 text-center shadow-[0_4px_4px_0_rgba(0,0,0,0.25),0_4px_12px_0_rgba(40,32,30,0.04)] ring-1 ring-black/5">
      <h1 className="font-wordmark text-5xl leading-[52px] font-bold tracking-[4.8px] text-[var(--brand-ink-950)]">
        JOSHING
      </h1>
      <div
        className="mx-auto mt-4 h-0.5 w-[60px] rounded-full bg-[var(--accent-gold)]"
        aria-hidden="true"
      />
      <p className="mt-4 text-center font-sans text-lg leading-6 font-normal tracking-[3.6px] text-[var(--warm-ink)] uppercase">
        Trivia you wish you were asked
      </p>
    </section>
  );
}

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const invitationToken = readInvitationToken(params);
  const userInvite = readUserInvite(params);
  // Resolve the invite's recipient phone server-side so the login panel can
  // pre-fill it. Deliberate privacy exception (D-AUTH-INVITE-PHONE-FIRST §2.3):
  // the full invited number crosses to the client on this invite-token-gated
  // path so the phone-first field arrives pre-populated and editable. The
  // invitee's own number is not a secret from them.
  const prefill = invitationToken ? await getInvitePrefillByToken(invitationToken) : null;
  const userInviteResolution = userInvite
    ? await resolveInviteLink(userInvite.handle, userInvite.token)
    : null;
  const invitePrefill = prefill
    ? {
        inviterName: prefill.inviterName,
        inviterUserId: prefill.inviterUserId,
        inviterAvatarColor: prefill.inviterAvatarColor,
        // Full number (not masked): the phone-first field pre-fills it so the
        // invitee can confirm or correct it (D-AUTH-INVITE-PHONE-FIRST §2.3).
        inviteePhone: prefill.inviteePhone,
      }
    : null;
  const inviteContext = prefill
    ? {
        inviterName: prefill.inviterName,
        inviterUserId: prefill.inviterUserId,
        inviterAvatarColor: prefill.inviterAvatarColor,
      }
    : userInviteResolution
      ? {
          inviterName:
            userInviteResolution.inviterDisplayName?.trim() ||
            `@${userInviteResolution.inviterHandle}`,
          inviterUserId: userInviteResolution.inviterUserId,
          inviterAvatarColor: userInviteResolution.inviterAvatarColor,
        }
      : null;

  return (
    <TriangleBackground>
      <main className="relative z-10 flex min-h-screen flex-col items-center justify-start gap-5 px-6 pt-14 pb-10">
        <TitleCard />
        <Suspense
          fallback={
            <div className="h-72 w-full max-w-sm rounded-2xl bg-[var(--brand-cream-card)] shadow-[0_4px_4px_0_rgba(0,0,0,0.25),0_4px_12px_0_rgba(40,32,30,0.04)] ring-1 ring-black/5" />
          }
        >
          <LoginPanel invitePrefill={invitePrefill} inviteContext={inviteContext} />
        </Suspense>
      </main>
    </TriangleBackground>
  );
}
