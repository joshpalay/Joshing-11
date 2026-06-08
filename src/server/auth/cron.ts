import type { NextRequest } from 'next/server';

/**
 * Shared authorization gate for cron- and admin-triggered routes
 * (queue generation, ceremony firing, question vetting, backfills, …).
 *
 * SECURITY — fails CLOSED. Every caller previously inlined its own
 * `isAuthorized()` that returned `true` when no secret was configured, so a
 * single missing env var silently made these privileged, side-effecting
 * endpoints publicly triggerable. This helper instead DENIES when the secret
 * is absent. `CRON_SECRET` is a required boot env var (see `src/env-check.ts`),
 * so a missing secret is a misconfiguration, not a valid "open" state.
 *
 * Accepted credential forms (any one matching the configured secret passes):
 *   - `Authorization: Bearer <secret>`  (Vercel Cron + external-crons.yml)
 *   - `cron_secret: <secret>`
 *   - `x-cron-secret: <secret>`
 */
export function isCronAuthorized(request: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET ?? process.env.VERCEL_CRON_SECRET)?.trim();

  if (!secret) {
    // Fail closed: without a configured secret there is no way to authenticate
    // the caller, so deny rather than wave everyone through.
    console.error(
      '[auth/cron] Denying request: neither CRON_SECRET nor VERCEL_CRON_SECRET is set. ' +
        'Set CRON_SECRET so cron/admin routes can authenticate.',
    );
    return false;
  }

  return (
    request.headers.get('authorization') === `Bearer ${secret}` ||
    request.headers.get('cron_secret') === secret ||
    request.headers.get('x-cron-secret') === secret
  );
}
