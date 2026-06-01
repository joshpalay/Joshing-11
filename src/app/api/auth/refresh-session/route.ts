import { NextResponse } from 'next/server';

import { getSession, refreshSessionInvitationClaim } from '@/server/auth/session';

/**
 * Graceful migration endpoint for sessions issued before the `inv` JWT
 * claim existed. Middleware redirects legacy sessions here; this handler
 * runs in the Node runtime, so DB calls are fine.
 *
 * Any valid session is re-signed with `inv: true` — established users
 * (including legacy accounts created before the invitation gate existed)
 * keep their session.
 */

function safeNextPath(rawNext: string | null): string {
  if (!rawNext) return '/';
  // Only allow same-origin relative paths. Strip anything that looks like
  // an absolute URL or protocol-relative URL to prevent open-redirect.
  if (!rawNext.startsWith('/') || rawNext.startsWith('//')) return '/';
  return rawNext;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));

  const session = await getSession();
  if (!session) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const refreshed = await refreshSessionInvitationClaim();
  if (!refreshed) {
    // The JWT couldn't be re-signed (e.g. cookie disappeared mid-flow).
    // Treat as auth failure rather than looping back to the same URL.
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
