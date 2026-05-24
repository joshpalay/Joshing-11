import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import { getSession } from '@/server/auth/session';
import { getDiscoverability } from '@/server/db/queries/account';
import {
  buildInviteUrl,
  getBaseUrl,
  getOrCreateInviteToken,
} from '@/server/friends/user-invite-token';
import { headers } from 'next/headers';

import { PrivacyForm } from './PrivacyForm';

export const dynamic = 'force-dynamic';

export default async function PrivacySettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const state = await getDiscoverability(session.userId);
  if (!state) redirect('/login');

  // Build the per-user invite URL server-side so the input renders populated
  // on first paint. If the user doesn't have a handle yet (pre-P0-A
  // accounts that haven't picked one), skip — the section won't render.
  const tokenResult = await getOrCreateInviteToken(session.userId);
  let inviteUrl: string | null = null;
  if (tokenResult?.handle) {
    const requestHeaders = await headers();
    inviteUrl = buildInviteUrl(getBaseUrl(requestHeaders), tokenResult.handle, tokenResult.token);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pt-10 pb-28">
      <Link
        href="/account"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back
      </Link>
      <h1 className="mt-6 font-serif text-3xl font-semibold leading-tight">
        Privacy &amp; visibility
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose how other people can find you on Joshing.
      </p>

      <PrivacyForm initialState={state} initialInviteUrl={inviteUrl} />
    </main>
  );
}
