/**
 * Session creation and validation using UserSession (Prisma).
 * A signed JWT is stored in an httpOnly cookie; PRD: 90-day persistence.
 */

import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

import { db } from '@/server/db';
import { userSessions } from '@/server/db/schema';

const SESSION_COOKIE_NAME = 'joshing_session';
const SESSION_DAYS = 90;

const SESSION_SECRET_KEYS = ['JWT_SECRET', 'AUTH_SECRET', 'NEXTAUTH_SECRET'] as const;

type SessionJwtPayload = {
  sid: string;
};

export type Session = {
  id: string;
  userId: string;
};

function readConfiguredSessionSecret(): string | null {
  for (const key of SESSION_SECRET_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }

  const cronFallback = process.env.CRON_SECRET?.trim();
  if (cronFallback) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[auth/session] Using CRON_SECRET as JWT fallback. Set JWT_SECRET (or AUTH_SECRET/NEXTAUTH_SECRET) in deployment env vars.',
      );
    }
    return cronFallback;
  }

  return null;
}

function getJwtSecret(): Uint8Array {
  const secret = readConfiguredSessionSecret();

  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error(
      'Missing session secret in production. Configure JWT_SECRET, AUTH_SECRET, or NEXTAUTH_SECRET.',
    );
  }

  if (!secret) {
    return new TextEncoder().encode('development-only-joshing-session-secret');
  }

  const decoded = Buffer.from(secret, 'base64');
  if (decoded.length > 0) return decoded;

  return new TextEncoder().encode(secret);
}

/**
 * Create a new UserSession for the user and set the session cookie.
 * Call after successful OTP verification (login).
 */
export async function createSession(userId: string): Promise<string> {
  const sessionId = randomBytes(24).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

  const token = await new SignJWT({ sid: sessionId } satisfies SessionJwtPayload)
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

export async function getSession(): Promise<Session | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const session = await validateSessionToken(token);
  if (!session) return null;

  return {
    id: session.session_id,
    userId: session.user_id,
  };
}

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
