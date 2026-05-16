import { NextResponse } from 'next/server'

import {
  destroySession,
  getSession,
  refreshSessionInvitationClaim,
} from '@/server/auth/session'
import { hasAcceptedInvitationForUser } from '@/server/friends/invitations'

/**
 * Graceful migration endpoint for sessions issued before the `inv` JWT
 * claim existed. Middleware redirects legacy sessions here; this handler
 * runs in the Node runtime, so DB calls are fine.
 *
 * - Session has prior accepted invitation -> re-sign JWT with `inv: true`
 *   and redirect to the original URL.
 * - Session has no prior accepted invitation -> destroy session and
 *   bounce to /login with reason=no_invitation. This catches legacy
 *   orphan accounts that existed before the F1.1/F1.2 gate was added.
 * - No session at all -> bounce to /login.
 */

function safeNextPath(rawNext: string | null): string {
  if (!rawNext) return '/'
  // Only allow same-origin relative paths. Strip anything that looks like
  // an absolute URL or protocol-relative URL to prevent open-redirect.
  if (!rawNext.startsWith('/') || rawNext.startsWith('//')) return '/'
  return rawNext
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const next = safeNextPath(url.searchParams.get('next'))

  const session = await getSession()
  if (!session) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  const hasInvitation = await hasAcceptedInvitationForUser(session.userId)
  if (!hasInvitation) {
    await destroySession()
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('reason', 'no_invitation')
    return NextResponse.redirect(loginUrl)
  }

  const refreshed = await refreshSessionInvitationClaim()
  if (!refreshed) {
    // The JWT couldn't be re-signed (e.g. cookie disappeared mid-flow).
    // Treat as auth failure rather than looping back to the same URL.
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.redirect(new URL(next, request.url))
}
