import { NextResponse, type NextRequest } from 'next/server';

import { readSessionClaims } from '@/server/auth/session';

const SESSION_COOKIE_NAME = 'joshing_session';

function tagTiming(response: NextResponse, startedAt: number): NextResponse {
  response.headers.set('Server-Timing', `proxy;dur=${Date.now() - startedAt}`);
  return response;
}

/**
 * Edge proxy: defense-in-depth JWT gate plus onboarding/login routing for
 * authenticated page requests. Reads `inv` and `onb` directly from the JWT
 * so no DB lookup or self-fetch happens on the steady-state path. Legacy
 * sessions missing `onb` are redirected once to
 * /api/auth/refresh-onboarding-claim, which does a single DB read and
 * re-mints the cookie.
 *
 * Every response is tagged with a Server-Timing header so middleware cost
 * shows up in the DevTools Network panel and on Vercel function logs.
 *
 * Route handlers MUST keep their own `getSession()` checks — this is an
 * additional fence, not a replacement.
 */
export async function middleware(request: NextRequest) {
  const startedAt = Date.now();
  if (request.method === 'OPTIONS') {
    return tagTiming(new NextResponse(null, { status: 200 }), startedAt);
  }

  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // Terms, Privacy, SMS program details, and their screenshot evidence are public: they are linked
  // from the logged-out /login card (opened in a new tab), so they must resolve without
  // a session — otherwise the proxy bounces the unauthenticated reader to
  // /login?next=/terms, a loop back into the very screen they came from. It
  // is equally readable when authenticated, so allow it through for everyone
  // before any auth/onboarding routing runs.
  if (
    pathname === '/terms' ||
    pathname === '/privacy' ||
    pathname === '/sms-consent' ||
    pathname === '/dev/invite-login' ||
    pathname === '/dev/onboarding/intro' ||
    pathname === '/dev/welcome-tour' ||
    pathname.startsWith('/compliance/')
  ) {
    return tagTiming(NextResponse.next(), startedAt);
  }

  const isLoginPage = pathname === '/login';
  // Both invite landing surfaces must be reachable logged-out so the invitee
  // can carry their invite into /login: /invite/<token> (FriendInvitation,
  // SMS-style) and /u/<handle>/<token> (per-user evergreen invite link,
  // B-Friends-3). Without /u/ here the proxy bounces the invitee to /login
  // and drops the invite params, so brand-new accounts hit the invite-only
  // gate at verify-otp and can never sign up.
  const isInvitePage = pathname.startsWith('/invite/') || pathname.startsWith('/u/');

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const claims = await readSessionClaims(token);

  if (!claims) {
    if (isApi) {
      return tagTiming(
        NextResponse.json(
          { error: 'unauthenticated', message: 'Sign in required.' },
          { status: 401 },
        ),
        startedAt,
      );
    }
    if (isLoginPage || isInvitePage) return tagTiming(NextResponse.next(), startedAt);
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname + search);
    return tagTiming(NextResponse.redirect(loginUrl), startedAt);
  }

  // Legacy session: valid JWT but no `inv` claim. Trigger graceful refresh.
  if (!claims.invitationAccepted) {
    if (isApi) {
      return tagTiming(
        NextResponse.json(
          {
            error: 'session_refresh_required',
            message: 'Session needs to be refreshed.',
          },
          { status: 401 },
        ),
        startedAt,
      );
    }
    if (isLoginPage || isInvitePage) return tagTiming(NextResponse.next(), startedAt);
    const refreshUrl = new URL('/api/auth/refresh-session', request.url);
    refreshUrl.searchParams.set('next', pathname + search);
    return tagTiming(NextResponse.redirect(refreshUrl), startedAt);
  }

  // Authenticated with valid invitation. API requests pass through; page
  // requests get the onboarding/login routing pass.
  if (isApi) return tagTiming(NextResponse.next(), startedAt);

  const isOnboardingPage = pathname === '/onboarding';
  const isAllowedOnboardingPath =
    isOnboardingPage ||
    pathname === '/logout' ||
    pathname.startsWith('/api/onboarding/') ||
    pathname.startsWith('/api/auth/');

  if (claims.onboardingComplete) {
    if (isOnboardingPage) {
      return tagTiming(NextResponse.redirect(new URL('/', request.url)), startedAt);
    }
    // /login is intentionally NOT redirected here. These claims are verified
    // from the JWT signature alone (no DB lookup), so they can outlive the DB
    // session — a "zombie" cookie after secret rotation, a deleted/expired
    // session row, or a DB reset. Bouncing /login -> / on signature alone
    // traps such a session: server getSession() (DB-checked) says logged-out,
    // so the home renders signed-out and /api/feed 401s, yet the proxy bars
    // the one recovery surface. The login page redirects genuinely
    // authenticated users home itself, via a DB-checked getSession().
    return tagTiming(NextResponse.next(), startedAt);
  }

  // claims.onboardingComplete is false: either the user genuinely hasn't
  // finished onboarding, or they did so before the `onb` claim existed and
  // their JWT is missing the field. Allow onboarding/auth paths through and
  // route everything else to the refresh endpoint, which does one DB read,
  // re-mints the JWT if needed, and bounces back. Steady-state is JWT-only.
  if (isAllowedOnboardingPath) return tagTiming(NextResponse.next(), startedAt);

  const refreshUrl = new URL('/api/auth/refresh-onboarding-claim', request.url);
  refreshUrl.searchParams.set('next', pathname + search);
  return tagTiming(NextResponse.redirect(refreshUrl), startedAt);
}

/**
 * Matcher excludes paths that must be reachable without an invitation:
 *  - /api/auth/* (OTP request/verify, logout, /me)
 *  - /api/cron/* (bearer-token authenticated, runs without a session)
 *  - /api/share/* and /share/* (public share-card surfaces)
 *  - /api/telemetry (handles unauth events from public surfaces)
 *  - /images/* (public static assets — e.g. the brand triangle background;
 *    must be reachable pre-auth on /login, and by the next/image optimizer)
 *  - Next.js internals and common static assets
 *
 * Note: /login and /invite are intentionally NOT excluded — the proxy
 * handles authenticated users hitting those pages (e.g. redirecting them
 * to /).
 */
export { middleware as proxy };

export const config = {
  matcher: [
    '/((?!api/auth|api/cron|api/share|api/telemetry|share|images|_next/static|_next/image|favicon\\.ico|__nextjs).*)',
  ],
};
