/**
 * Load current user from session/token (cookie).
 * Use in server components, route handlers, and server actions.
 */

import { Prisma, type User } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSession } from './session';

const AUTH_USER_SELECT = {
  id: true,
  phone_number: true,
  display_name: true,
  timezone: true,
  preferred_theme: true,
} as const;

const AUTH_USER_FALLBACK_SELECT = {
  id: true,
  phone_number: true,
  display_name: true,
  timezone: true,
} as const;

function isSchemaDriftError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2021' || error.code === 'P2022');
}

/**
 * Returns the authenticated user if the request has a valid session cookie.
 * Returns null if no session, invalid token, or expired session.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      // Select explicit columns so auth remains resilient when preview DBs lag
      // behind the newest additive columns.
      select: AUTH_USER_SELECT,
    });
    return user as User | null;
  } catch (error) {
    if (!isSchemaDriftError(error)) {
      throw error;
    }

    console.warn('[auth] getCurrentUser primary select failed, retrying with fallback', {
        code: error.code,
        modelName: error.meta?.modelName,
        sessionUserId: session.userId,
      });

    try {
      const fallbackUser = await prisma.user.findUnique({
        where: { id: session.userId },
        select: AUTH_USER_FALLBACK_SELECT,
      });
      return fallbackUser as User | null;
    } catch (fallbackError) {
      if (!isSchemaDriftError(fallbackError)) {
        throw fallbackError;
      }

      console.warn('[auth] getCurrentUser fallback select failed, returning null', {
        code: fallbackError.code,
        modelName: fallbackError.meta?.modelName,
        sessionUserId: session.userId,
      });
      return null;
    }
  }
}

/**
 * Require a current user; throws if unauthenticated.
 * Use in server actions. For API routes, use getCurrentUser() and return
 * NextResponse.json({ error: 'unauthorized' }, { status: 401 }) when null.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}
