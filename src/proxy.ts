import { NextResponse, type NextRequest } from 'next/server'

import { readSessionClaims } from '@/server/auth/session'

const SESSION_COOKIE_NAME = 'joshing_session'

type AuthMeResponse = {
  user?: {
    onboardingComplete?: boolean
  }
}

async function getAuthenticatedUser(
  request: NextRequest,
): Promise<AuthMeResponse['user'] | null> {
  const response = await fetch(new URL('/api/auth/me', request.url), {
    headers: {
      cookie: request.headers.get('cookie') ?? '',
    },
    cache: 'no-store',
  }).catch(() => null)

  if (!response?.ok) return null

  const data = (await response
    .json()
    .catch(() => null)) as AuthMeResponse | null
  return data?.user ?? null
}

/**
 * Combined edge proxy:
 *  1. Defense-in-depth JWT gate (edge-safe, only verifies signature + `inv` claim).
 *  2. Onboarding/login routing for authenticated page requests (calls
 *     `/api/auth/me` in the Node runtime to read onboarding state).
 *
 * Route handlers MUST keep their own `getSession()` checks — this is an
 * additional fence, not a replacement.
 */
export async function middleware(request: NextRequest) {
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 200 })
  }

  const { pathname, search } = request.nextUrl
  const isApi = pathname.startsWith('/api/')
  const isLoginPage = pathname === '/login'
  const isInvitePage = pathname.startsWith('/invite/')

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const claims = await readSessionClaims(token)

  if (!claims) {
    if (isApi) {
      return NextResponse.json(
        { error: 'unauthenticated', message: 'Sign in required.' },
        { status: 401 },
      )
    }
    if (isLoginPage || isInvitePage) return NextResponse.next()
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname + search)
    return NextResponse.redirect(loginUrl)
  }

  // Legacy session: valid JWT but no `inv` claim. Trigger graceful refresh.
  if (!claims.invitationAccepted) {
    if (isApi) {
      return NextResponse.json(
        {
          error: 'session_refresh_required',
          message: 'Session needs to be refreshed.',
        },
        { status: 401 },
      )
    }
    if (isLoginPage || isInvitePage) return NextResponse.next()
    const refreshUrl = new URL('/api/auth/refresh-session', request.url)
    refreshUrl.searchParams.set('next', pathname + search)
    return NextResponse.redirect(refreshUrl)
  }

  // Authenticated with valid invitation. API requests pass through; page
  // requests get the onboarding/login routing pass.
  if (isApi) return NextResponse.next()

  const isOnboardingPage = pathname === '/onboarding'
  const isAllowedOnboardingPath =
    isOnboardingPage ||
    pathname === '/logout' ||
    pathname.startsWith('/api/onboarding/') ||
    pathname.startsWith('/api/auth/')

  const user = await getAuthenticatedUser(request)

  if (!user) {
    if (isLoginPage || isInvitePage) return NextResponse.next()
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    return NextResponse.redirect(loginUrl)
  }

  if (!user.onboardingComplete && !isAllowedOnboardingPath) {
    const onboardingUrl = request.nextUrl.clone()
    onboardingUrl.pathname = '/onboarding'
    onboardingUrl.search = ''
    return NextResponse.redirect(onboardingUrl)
  }

  if (user.onboardingComplete && (isLoginPage || isOnboardingPage)) {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = '/'
    homeUrl.search = ''
    return NextResponse.redirect(homeUrl)
  }

  return NextResponse.next()
}

/**
 * Matcher excludes paths that must be reachable without an invitation:
 *  - /api/auth/* (OTP request/verify, logout, /me)
 *  - /api/cron/* (bearer-token authenticated, runs without a session)
 *  - /api/share/* and /share/* (public share-card surfaces)
 *  - /api/telemetry (handles unauth events from public surfaces)
 *  - Next.js internals and common static assets
 *
 * Note: /login and /invite are intentionally NOT excluded — the proxy
 * handles authenticated users hitting those pages (e.g. redirecting them
 * to /).
 */
export { middleware as proxy }

export const config = {
  matcher: [
    '/((?!api/auth|api/cron|api/share|api/telemetry|share|_next/static|_next/image|favicon\\.ico|__nextjs).*)',
  ],
}
