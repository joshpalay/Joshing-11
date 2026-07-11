/**
 * Session creation and validation using the UserSession table (Drizzle).
 * A signed JWT is stored in an httpOnly cookie; PRD: 90-day persistence.
 */

import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { cache } from 'react';

import { db } from '@/server/db';
import { userSessions } from '@/server/db/schema';

const SESSION_COOKIE_NAME = 'joshing_session';
const SESSION_DAYS = 90;

const SESSION_SECRET_KEYS = ['JWT_SECRET', 'AUTH_SECRET', 'NEXTAUTH_SECRET'] as const;
const MISSING_SECRET_ERROR =
  'JWT_SECRET (or AUTH_SECRET/NEXTAUTH_SECRET) is required in production. Configure it in your deployment environment variables.';

type SessionJwtPayload = {
  sid: string;
  /**
   * Set to true when the session was minted (or refreshed) after the user's
   * invitation acceptance was confirmed. Middleware uses this as a fast
   * Edge-safe gate without a DB lookup. Legacy sessions (issued before this
   * claim existed) omit the field and must be refreshed via
   * /api/auth/refresh-session.
   */
  inv?: boolean;
  /**
   * Set to true when the user has completed onboarding. Middleware reads
   * this directly from the JWT to decide whether to redirect to /onboarding,
   * avoiding a per-navigation DB read. Sessions issued before this claim
   * existed omit the field and are refreshed via
   * /api/auth/refresh-onboarding-claim on first need.
   */
  onb?: boolean;
};

export type Session = {
  id: string;
  userId: string;
};

export type SessionJwtClaims = {
  userId: string;
  sessionId: string;
  invitationAccepted: boolean;
  onboardingComplete: boolean;
};

function readConfiguredSessionSecret(): string | null {
  for (const key of SESSION_SECRET_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }

  // CRON_SECRET is a convenience fallback for local/dev only. It MUST NOT sign
  // user sessions in production: CRON_SECRET also authorizes the cron/admin
  // routes (src/server/auth/cron.ts), so reusing it for JWT signing means a
  // leaked cron secret becomes session forgery. In production we refuse the
  // fallback and let getJwtSecret() throw MISSING_SECRET_ERROR instead.
  const cronFallback = process.env.CRON_SECRET?.trim();
  if (cronFallback) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[auth/session] Refusing to use CRON_SECRET as JWT fallback in production. ' +
          'Set JWT_SECRET (or AUTH_SECRET/NEXTAUTH_SECRET) in deployment env vars.',
      );
      return null;
    }
    return cronFallback;
  }

  return null;
}

function getJwtSecret(): Uint8Array {
  if (cachedJwtSecret) return cachedJwtSecret;

  const secret = readConfiguredSessionSecret();

  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error(MISSING_SECRET_ERROR);
  }

  if (!secret) {
    cachedJwtSecret = new TextEncoder().encode('development-only-joshing-session-secret');
    return cachedJwtSecret;
  }

  const decoded = Buffer.from(secret, 'base64');
  cachedJwtSecret = decoded.length > 0 ? new Uint8Array(decoded) : new TextEncoder().encode(secret);
  return cachedJwtSecret;
}

// Memoize across the worker's lifetime. The secret is process-stable; without
// this, every readSessionClaims / validateSessionToken call re-walks the env
// lookup chain and re-runs Buffer.from(_, 'base64'). Tests that need to vary
// the secret should mock this function or use vi.resetModules() between cases.
let cachedJwtSecret: Uint8Array | null = null;

/**
 * Create a new UserSession for the user and set the session cookie.
 * Call after successful OTP verification (login).
 *
 * `invitationAccepted` MUST be true — callers should only mint a session
 * after the invitation gate has been satisfied (see
 * src/app/api/auth/verify-otp/route.ts). The flag is required (rather than
 * defaulted) to prevent accidental regression of the gate.
 */
export async function createSession(
  userId: string,
  options: { invitationAccepted: true; onboardingComplete: boolean },
): Promise<string> {
  const sessionId = randomBytes(24).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

  const payload: SessionJwtPayload = {
    sid: sessionId,
    inv: options.invitationAccepted,
    onb: options.onboardingComplete,
  };

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getJwtSecret());

  await db.insert(userSessions).values({ userId, token, expiresAt });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: '/',
  });

  return token;
}

/**
 * Edge-safe: verifies the JWT signature and returns the claims, without
 * touching the database. Used by middleware to gate authenticated routes.
 * Returns null if the token is missing/invalid/expired.
 */
export async function readSessionClaims(
  token: string | null | undefined,
): Promise<SessionJwtClaims | null> {
  if (!token) return null;

  try {
    const verified = await jwtVerify<SessionJwtPayload>(token, getJwtSecret());
    const { sub, sid, inv, onb } = verified.payload;
    if (!sub || typeof sid !== 'string') return null;
    return {
      userId: sub,
      sessionId: sid,
      invitationAccepted: inv === true,
      onboardingComplete: onb === true,
    };
  } catch {
    return null;
  }
}

/**
 * Re-sign the current session JWT with `inv: true`. Used by the refresh
 * endpoint to upgrade legacy sessions (issued before the invitation claim
 * existed) without forcing the user to log in again.
 *
 * The DB row's `token` column is updated to the new JWT so that
 * `validateSessionToken` continues to match by token.
 */
export async function refreshSessionInvitationClaim(): Promise<boolean> {
  const cookieStore = await cookies();
  const existingToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!existingToken) return false;

  let userId: string;
  let sessionId: string;
  let onb: boolean;
  try {
    const verified = await jwtVerify<SessionJwtPayload>(
      existingToken,
      getJwtSecret(),
    );
    if (!verified.payload.sub || typeof verified.payload.sid !== 'string') {
      return false;
    }
    userId = verified.payload.sub;
    sessionId = verified.payload.sid;
    onb = verified.payload.onb === true;
  } catch {
    return false;
  }

  const [existingRow] = await db
    .select({ id: userSessions.id, expiresAt: userSessions.expiresAt })
    .from(userSessions)
    .where(eq(userSessions.token, existingToken))
    .limit(1);

  if (!existingRow || existingRow.expiresAt < new Date()) return false;

  const payload: SessionJwtPayload = { sid: sessionId, inv: true, onb };
  const newToken = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getJwtSecret());

  await db
    .update(userSessions)
    .set({ token: newToken })
    .where(eq(userSessions.id, existingRow.id));

  cookieStore.set(SESSION_COOKIE_NAME, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: '/',
  });

  return true;
}

/**
 * Re-sign the current session JWT with `onb: true`. Used by
 * /api/auth/refresh-onboarding-claim to upgrade sessions that completed
 * onboarding before the JWT claim existed, and by the onboarding-complete
 * flow so the very next request sees the new state without a DB lookup.
 *
 * The existing `inv` value is preserved so this never downgrades the
 * invitation gate. The DB row's `token` column is updated to match the new
 * JWT so `validateSessionToken` continues to find the row.
 */
export async function refreshSessionOnboardingClaim(): Promise<boolean> {
  const cookieStore = await cookies();
  const existingToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!existingToken) return false;

  let userId: string;
  let sessionId: string;
  let inv: boolean;
  try {
    const verified = await jwtVerify<SessionJwtPayload>(
      existingToken,
      getJwtSecret(),
    );
    if (!verified.payload.sub || typeof verified.payload.sid !== 'string') {
      return false;
    }
    userId = verified.payload.sub;
    sessionId = verified.payload.sid;
    inv = verified.payload.inv === true;
  } catch {
    return false;
  }

  const [existingRow] = await db
    .select({ id: userSessions.id, expiresAt: userSessions.expiresAt })
    .from(userSessions)
    .where(eq(userSessions.token, existingToken))
    .limit(1);

  if (!existingRow || existingRow.expiresAt < new Date()) return false;

  const payload: SessionJwtPayload = { sid: sessionId, inv, onb: true };
  const newToken = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getJwtSecret());

  await db
    .update(userSessions)
    .set({ token: newToken })
    .where(eq(userSessions.id, existingRow.id));

  cookieStore.set(SESSION_COOKIE_NAME, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: '/',
  });

  return true;
}

/**
 * Get the current session token from the request cookie.
 */
export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

/**
 * Validate JWT and UserSession: returns session if valid and not expired.
 */
export async function validateSessionToken(
  token: string
): Promise<{ user_id: string; session_id: string } | null> {
  let jwtUserId: string | undefined;
  let jwtSessionId: unknown;

  try {
    const verified = await jwtVerify<SessionJwtPayload>(token, getJwtSecret());
    jwtUserId = verified.payload.sub;
    jwtSessionId = verified.payload.sid;
  } catch {
    return null;
  }

  if (!jwtUserId || typeof jwtSessionId !== 'string') return null;

  const [session] = await db
    .select({ id: userSessions.id, userId: userSessions.userId, expiresAt: userSessions.expiresAt })
    .from(userSessions)
    .where(eq(userSessions.token, token))
    .limit(1);

  if (!session || session.expiresAt < new Date() || session.userId !== jwtUserId) return null;

  return { user_id: session.userId, session_id: session.id };
}

// Request-scoped memoization: a single page render commonly resolves the session
// several times (layout + page + nested server components), and each call hits
// the DB via validateSessionToken. `cache` collapses those to one lookup per
// request. It is request-scoped — the cookie can't change mid-request — so there
// is no cross-request staleness; login/logout land on a fresh request.
export const getSession = cache(async (): Promise<Session | null> => {
  const token = await getSessionToken();
  if (!token) return null;

  const session = await validateSessionToken(token);
  if (!session) return null;

  return {
    id: session.session_id,
    userId: session.user_id,
  };
});

/**
 * Delete the session (logout): remove from DB and clear cookie.
 */
export async function destroySession(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    await db.delete(userSessions).where(eq(userSessions.token, token));
  }
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
