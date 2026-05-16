import { NextResponse, type NextRequest } from 'next/server'

import { readSessionClaims } from '@/server/auth/session'

const SESSION_COOKIE_NAME = 'joshing_session'

/**
 * Defense-in-depth gate enforced ahead of every authenticated page and API
 * route. Route handlers MUST keep their own `getSession()` checks — this is
 * an additional fence, not a replacement.
 *
 * Edge-safe: only verifies the JWT signature and reads the `inv` claim. No
 * database access. Legacy sessions (issued before the claim existed) are
 * redirected to /api/auth/refresh-session, which runs in the Node runtime
 * and does a one-time DB check + JWT re-sign.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const claims = await readSessionClaims(token)
  const isApi = pathname.startsWith('/api/')

  if (!claims) {
    if (isApi) {
      return NextResponse.json(
        { error: 'unauthenticated', message: 'Sign in required.' },
        { status: 401 },
      )
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname + search)
    return NextResponse.redirect(loginUrl)
  }

  if (claims.invitationAccepted) {
    return NextResponse.next()
  }

  // Legacy session: valid JWT but no `inv` claim. Trigger graceful refresh.
  if (isApi) {
    return NextResponse.json(
      {
        error: 'session_refresh_required',
        message: 'Session needs to be refreshed.',
      },
      { status: 401 },
    )
  }

  const refreshUrl = new URL('/api/auth/refresh-session', request.url)
  refreshUrl.searchParams.set('next', pathname + search)
  return NextResponse.redirect(refreshUrl)
}

/**
 * Matcher excludes paths that must be reachable without an invitation:
 *  - /login (the login flow itself)
 *  - /invite/[token] (the invitation landing page)
 *  - /api/auth/* (OTP request/verify, logout, /me)
 *  - /api/cron/* (bearer-token authenticated, runs without a session)
 *  - /api/share/* and /share/* (public share-card surfaces)
 *  - /api/telemetry (handles unauth events from public surfaces)
 *  - Next.js internals and common static assets
 */
export const config = {
  matcher: [
    '/((?!api/auth|api/cron|api/share|api/telemetry|share|login|invite|_next/static|_next/image|favicon\\.ico|__nextjs).*)',
  ],
}
