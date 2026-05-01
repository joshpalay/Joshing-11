/**
 * Load current user from session/token (cookie).
 * Use in server components, route handlers, and server actions.
 */

import type { InferSelectModel } from 'drizzle-orm';

import type { users } from '@/server/db/schema';
import { getUserById } from '@/server/db/queries/users';
import { getSession } from './session';

export type User = InferSelectModel<typeof users>;

/**
 * Returns the authenticated user if the request has a valid session cookie.
 * Returns null if no session, invalid token, or expired session.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;

  return getUserById(session.userId);
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
