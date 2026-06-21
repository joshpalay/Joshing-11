// Public-handle validation. Used by:
//   - GET /api/handle/check (signup picker, debounced live validation)
//   - PATCH /api/account/handle (authenticated handle change)
//   - scripts/backfill-user-handles.ts (one-shot backfill)
//
// Format and reserved list are enumerated below — top-level routes are
// snapshotted as a constant rather than computed at runtime so the list
// stays deterministic across builds.

import { sql } from 'drizzle-orm';

import { db, users } from '@/server/db';

// Enumerated from src/app/ top-level directories (2026-05-23 audit). Anything
// that resolves to a top-level route must NOT be claimable as a handle.
const ROUTE_RESERVED = [
  'account',
  'activities',
  'api',
  'archive',
  'ceremony',
  'daily',
  'dev',
  'feed',
  'friends',
  'games',
  'invite',
  'knowledge',
  'login',
  'new-game',
  'onboarding',
  'questions',
  'share',
  'users',
] as const;

const NAME_RESERVED = [
  'admin',
  'joshing',
  'system',
  'api',
  'account',
  'friends',
  'invite',
  'me',
  'support',
] as const;

const RESERVED = new Set<string>([
  ...ROUTE_RESERVED.map((entry) => entry.toLowerCase()),
  ...NAME_RESERVED.map((entry) => entry.toLowerCase()),
]);

// Must start with a letter, then 2–19 chars of [a-z0-9_]. Total length 3–20.
// Lowercase only; callers normalize before validating.
const FORMAT = /^[a-z][a-z0-9_]{2,19}$/;

export type HandleValidationResult =
  | { ok: true }
  | { ok: false; reason: 'format' | 'reserved' | 'taken' };

export function isValidHandleFormat(handle: string): boolean {
  return FORMAT.test(handle);
}

export function isReservedHandle(handle: string): boolean {
  return RESERVED.has(handle.toLowerCase());
}

export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

// Strip non-[a-z0-9_], lowercase, ensure leading letter. Returns null when
// nothing usable remains — caller must fall back to a uuid-derived handle.
export function sanitizeForHandle(input: string): string | null {
  const stripped = input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^[^a-z]+/, '');

  if (!stripped) return null;
  return stripped.slice(0, 16);
}

export async function isHandleTaken(handle: string, excludeUserId?: string): Promise<boolean> {
  const normalized = normalizeHandle(handle);
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`LOWER(${users.handle}) = ${normalized}`)
    .limit(1);

  if (rows.length === 0) return false;
  if (excludeUserId && rows[0]?.id === excludeUserId) return false;
  return true;
}

export async function validateHandle(
  raw: string,
  options: { excludeUserId?: string } = {},
): Promise<HandleValidationResult> {
  const normalized = normalizeHandle(raw);
  if (!isValidHandleFormat(normalized)) return { ok: false, reason: 'format' };
  if (isReservedHandle(normalized)) return { ok: false, reason: 'reserved' };
  if (await isHandleTaken(normalized, options.excludeUserId)) {
    return { ok: false, reason: 'taken' };
  }
  return { ok: true };
}
