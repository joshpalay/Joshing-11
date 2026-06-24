import { NextResponse } from 'next/server';

import { destroySession } from '@/server/auth/session';

/**
 * Log out. Idempotent by design: ALWAYS clears the `joshing_session` cookie
 * (and deletes the matching DB row if one exists), regardless of whether the
 * cookie currently resolves to a valid session.
 *
 * Previously this gated on `getSession()` and returned 401 when no valid
 * session was found — which made logout refuse to clear a "zombie" cookie: a
 * validly-signed JWT whose DB session row is gone (secret rotation, deleted/
 * expired row, DB reset). Such a cookie passes the Edge proxy's signature-only
 * gate but fails the server's DB-checked `getSession()`, leaving the user
 * "logged in at the edge, logged out at the server": the signed-out home
 * renders, `/api/feed` 401s, and the proxy bars `/login`. Refusing to clear
 * the cookie on a missing session meant the user could never escape that state.
 * Clearing unconditionally breaks the loop. Mirrors /api/auth/logout.
 */
export async function POST() {
  await destroySession();

  return NextResponse.json({ ok: true });
}
