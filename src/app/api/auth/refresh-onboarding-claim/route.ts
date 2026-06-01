import { NextResponse } from 'next/server';

import { getSession, refreshSessionOnboardingClaim } from '@/server/auth/session';
import { getUserOnboardingProfile } from '@/server/db/queries/users';

/**
 * Graceful migration endpoint for sessions issued before the `onb` JWT
 * claim existed. The edge proxy redirects authenticated page requests here
 * when `claims.onboardingComplete` is false; this handler does one DB read
 * to discover the actual state, re-mints the cookie if the user already
 * finished onboarding, then 302s back to the original path. After the
 * single refresh the steady-state path is JWT-only.
 */

function safeNextPath(rawNext: string | null): string {
  if (!rawNext) return '/';
  // Only allow same-origin relative paths.
  if (!rawNext.startsWith('/') || rawNext.startsWith('//')) return '/';
  return rawNext;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));

  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const user = await getUserOnboardingProfile(session.userId);
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (!user.onboardingComplete) {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  const refreshed = await refreshSessionOnboardingClaim();
  if (!refreshed) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
