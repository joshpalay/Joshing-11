import { Suspense } from 'react';

import TriangleBackground from '@/components/TriangleBackground';
import { getInvitePrefillByToken } from '@/server/friends/invitations';

import LoginPanel from './LoginPanel';

// Mirror LoginPanel.readInvitationToken: accept any of the aliases an invite
// link may use so the prefill resolves regardless of which one routed here.
function readInvitationToken(
  params: Record<string, string | string[] | undefined>
): string | null {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  return (
    first(params.invitationToken) ??
    first(params.invite) ??
    first(params.token) ??
    null
  );
}

function TitleCard() {
  return (
    <section className="w-full max-w-sm rounded-[8px] bg-[var(--brand-cream-card)] px-[46px] py-7 text-center shadow-[0_4px_4px_0_rgba(0,0,0,0.25),0_4px_12px_0_rgba(40,32,30,0.04)] ring-1 ring-black/5">
      <h1 className="font-sans text-5xl font-bold leading-[52px] tracking-[4.8px] text-[var(--brand-ink-950)]">
        JOSHING
      </h1>
      <div className="mx-auto mt-4 h-0.5 w-[60px] rounded-full bg-[var(--tri-amber)]" aria-hidden="true" />
      <p className="mt-4 text-center font-inter text-lg font-normal uppercase leading-6 tracking-[3.6px] text-[var(--warm-ink)]">
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
  // Resolve the invite's recipient phone server-side so the login panel can
  // skip manual phone entry. Only the masked form crosses to the client — the
  // raw phone never leaves the server.
  const prefill = invitationToken
    ? await getInvitePrefillByToken(invitationToken)
    : null;
  const invitePrefill = prefill
    ? { inviterName: prefill.inviterName, maskedPhone: prefill.maskedPhone }
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
          <LoginPanel invitePrefill={invitePrefill} />
        </Suspense>
      </main>
    </TriangleBackground>
  );
}
