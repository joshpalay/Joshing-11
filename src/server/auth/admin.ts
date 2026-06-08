/**
 * B-Report-5 admin gate. Mirrors the CRON_SECRET style in `src/server/auth/cron.ts`
 * (fail closed): membership is an `ADMIN_USER_IDS` env allowlist, NOT a role column.
 *
 * `ADMIN_USER_IDS` is a comma-separated list of `users.id` values and is OPTIONAL
 * (see src/env-check.ts). Unset ⇒ no admins ⇒ the admin queue is unreachable and
 * every caller 404s — the correct safe default. Callers that fail this check must
 * return 404 (never 403): the route's existence is not revealed to non-admins.
 */
export function isAdminUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const raw = process.env.ADMIN_USER_IDS?.trim();
  if (!raw) return false;
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}
