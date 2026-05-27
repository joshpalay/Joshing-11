import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';

// Bottom-nav "Profile" tab and any link to /users/me lands here. Resolve
// the session once and redirect to the canonical /users/<id> URL so the
// rest of the profile pipeline only has to handle the literal id form.
//
// src/proxy.ts already gates /users/* behind authentication, so an
// unauthenticated request would already have been redirected before
// reaching this route — but we re-check defensively for the case where
// the proxy matcher is bypassed (tests, alternate deployments).
export const dynamic = 'force-dynamic';

export default async function UsersMeRedirectPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  redirect(`/users/${session.userId}`);
}
