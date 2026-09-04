/**
 * Guard: a local process must never auto-apply schema changes to a remote
 * database.
 *
 * WHY THIS EXISTS. On 2026-09-03 a `npm run dev` boot on an unmerged feature
 * branch applied migration 0136 to the PRODUCTION database as a side effect of
 * starting up. Nothing about that was intended and nothing prevented it: this
 * repo's local `.env` DATABASE_URL points at production, `register()` calls
 * `migrate()` on every boot, and `migrate()` applies every pending migration it
 * finds on the current branch. The migration wrote a wrong `target_size` to 148
 * live rows. It was inert (nothing read the column) so no user was affected,
 * but the same boot on a branch with a destructive migration would not have
 * been recoverable. Production is actively serving -- 10 queues, 80 answers, 5
 * distinct users in the trailing week -- so this is live traffic, not a dormant
 * environment.
 *
 * THE RULE. Auto-migrate on boot is for DEPLOYED environments. Anywhere else,
 * a remote target requires a deliberate, explicit act.
 *
 * Two independent signals have to agree before a boot may migrate a remote
 * database:
 *   1. the process is running on a deploy platform (Vercel sets VERCEL=1), or
 *   2. the operator has explicitly opted in for this one run.
 * Neither `NODE_ENV` nor "it looks like production" is trusted, because the
 * incident happened with `NODE_ENV=development` -- the environment name was
 * never the thing that made it dangerous. The connection target is.
 */

/** Hosts that are unambiguously a developer's own machine. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);

export type MigrateDecision =
  | { allowed: true; reason: 'local_target' | 'deploy_platform' | 'explicit_override' }
  | { allowed: false; reason: 'remote_target_from_local_process'; host: string };

/**
 * Pure so it can be unit tested without a database, a network, or a real
 * environment. Callers pass the connection string and the relevant env.
 */
export function decideBootMigrate(
  connectionString: string | undefined,
  env: { VERCEL?: string; ALLOW_REMOTE_BOOT_MIGRATE?: string } = {},
): MigrateDecision {
  // An explicit, per-run opt-in. Deliberately NOT a value anyone would already
  // have set for another purpose, and deliberately not inferable from
  // NODE_ENV.
  if (env.ALLOW_REMOTE_BOOT_MIGRATE === '1') {
    return { allowed: true, reason: 'explicit_override' };
  }

  // Deployed environments migrate on boot as before -- this guard must not
  // change how production deploys apply schema.
  if (env.VERCEL) return { allowed: true, reason: 'deploy_platform' };

  const host = hostFromConnectionString(connectionString);

  // Unparseable or absent connection string: treat as remote. Failing closed
  // is right here -- the cost of a wrongly-skipped local migration is one
  // manual command; the cost of a wrongly-allowed remote one is this incident.
  if (!host) return { allowed: false, reason: 'remote_target_from_local_process', host: '(unknown)' };

  if (LOCAL_HOSTS.has(host)) return { allowed: true, reason: 'local_target' };

  return { allowed: false, reason: 'remote_target_from_local_process', host };
}

/** Host only -- never the credentials, which must not reach a log line. */
export function hostFromConnectionString(connectionString: string | undefined): string | null {
  if (!connectionString) return null;
  try {
    // An IPv6 host is bracketed in a URL ("postgresql://u:p@[::1]:5432/db") and
    // URL.hostname hands the brackets back, so "[::1]" would never match the
    // bare "::1" in LOCAL_HOSTS -- a loopback target would have been treated as
    // remote and refused. Strip them.
    const hostname = new URL(connectionString).hostname;
    if (!hostname) return null;
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  } catch {
    return null;
  }
}

/**
 * The operator-facing message for a refusal. Names the host so it is obvious
 * WHICH database was protected, and names the exact escape hatch so nobody has
 * to go looking for it.
 */
export function refusalMessage(host: string): string {
  return [
    `[instrumentation] REFUSING to auto-apply migrations: this process is not running on a deploy platform, but DATABASE_URL points at a remote host (${host}).`,
    'A local boot silently migrated the production database on 2026-09-03; this guard exists to stop that recurring.',
    'The app will start normally and serve requests -- only the automatic migrate() is skipped.',
    'To apply migrations deliberately: run `npm run db:migrate`, or set ALLOW_REMOTE_BOOT_MIGRATE=1 for a single run.',
  ].join(' ');
}
