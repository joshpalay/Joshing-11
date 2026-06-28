import { inArray } from 'drizzle-orm';

import { adminUserIds } from '@/server/auth/admin';
import { db, users } from '@/server/db';

/** A selectable admin author for the bulk-upload tool. */
export type AdminAccount = { id: string; displayName: string };

/**
 * Resolve the `ADMIN_USER_IDS` allowlist to real user rows for the author
 * picker. Allowlist entries that don't resolve to a `users` row are dropped
 * (a typo'd id is not a valid author, and createQuestion would FK-fail on it),
 * and the result preserves the allowlist's declared order. Returns [] when the
 * allowlist is unset/empty.
 */
export async function getAdminAccounts(): Promise<AdminAccount[]> {
  const ids = adminUserIds();
  if (ids.length === 0) return [];

  const rows = await db
    .select({ id: users.id, displayName: users.displayName, handle: users.handle })
    .from(users)
    .where(inArray(users.id, ids));

  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => ({
      id: row.id,
      displayName: row.displayName?.trim() || (row.handle ? `@${row.handle}` : row.id),
    }));
}
