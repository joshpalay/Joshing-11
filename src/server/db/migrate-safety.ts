/**
 * Guard: a local process must never auto-apply schema changes to a remote
 * database.
 *
 * WHY THIS EXISTS. On 2026-09-03 a `npm run dev` boot on an unmerged feature
 * branch applied migration 0136 to the PRODUCTION database as a side effect of
 * starting up. Nothing about that was intended and nothing prevented it: this
 * repo's local `.env` DATABASE_URL points at production, `register()` writes
 * schema on every boot, and it writes whatever the current branch happens to
 * contain. The migration wrote a wrong `target_size` to 148 live rows. It was
 * inert (nothing read the column) so no user was affected, but the same boot on
 * a branch with a destructive change would not have been recoverable.
 * Production is actively serving, so this is live traffic, not a dormant
 * environment.
 *
 * TWO DOORS, NOT ONE. `register()` reaches the database along two independent
 * paths, and BOTH write DDL:
 *
 *   1. the ~70 idempotent boot guards (ADD COLUMN IF NOT EXISTS, CREATE TABLE
 *      IF NOT EXISTS, CREATE INDEX IF NOT EXISTS), which run FIRST and are not
 *      recorded in the migration journal at all; and
 *   2. `migrate()`, which is journalled.
 *
 * Only the second is what people picture when they think "migrations", but the
 * first is DDL against whatever DATABASE_URL points at, executed before
 * `migrate()` gets a turn. Gating only `migrate()` would close the door the
 * incident happened to use and leave ~70 statements walking through the other.
 * So this decision gates the whole schema-writing phase.
 *
 * (The two-route split is itself worth knowing about: it is why "what actually
 * applied?" was hard to answer after the incident. Unifying them is a larger
 * change than this one and is logged, not attempted here.)
 *
 * THE RULE. Auto schema-write on boot is for PRODUCTION DEPLOYS. Anywhere
 * else, a remote target requires a deliberate, explicit act.
 *
 * Neither `NODE_ENV` nor "it looks like production" is trusted, because the
 * incident happened with `NODE_ENV=development` -- the environment name was
 * never the thing that made it dangerous. The connection target is.
 */

/** Hosts that are unambiguously a developer's own machine. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);

export type SchemaWriteDecision =
  | { allowed: true; reason: 'local_target' | 'production_deploy' | 'explicit_override'; host: string }
  | { allowed: false; reason: 'remote_target_without_authorization'; host: string };

export type BootEnv = {
  VERCEL_ENV?: string;
  ALLOW_REMOTE_BOOT_MIGRATE?: string;
};

/**
 * Pure so it can be unit tested without a database, a network, or a real
 * environment. Callers pass the connection string and the relevant env.
 */
export function decideBootSchemaWrite(
  connectionString: string | undefined,
  env: BootEnv = {},
): SchemaWriteDecision {
  const host = hostFromConnectionString(connectionString) ?? '(unknown)';

  // An explicit, per-run opt-in. Deliberately NOT a value anyone would already
  // have set for another purpose, and deliberately not inferable from NODE_ENV.
  // Its use is logged loudly by the caller -- the incident's defining feature
  // was that it left no trace.
  if (env.ALLOW_REMOTE_BOOT_MIGRATE === '1') {
    return { allowed: true, reason: 'explicit_override', host };
  }

  // PRODUCTION deploys migrate on boot exactly as before -- this guard must not
  // change how production applies schema.
  //
  // Note this is VERCEL_ENV === 'production', NOT the presence of VERCEL.
  // `VERCEL` is set on EVERY Vercel deployment including previews, so keying on
  // it would let any branch that gets a preview deploy write schema to whatever
  // DATABASE_URL that environment resolves to. If preview shares the production
  // connection string, that is the incident again, sourced from CI instead of a
  // laptop -- and permitted. Previews therefore need the explicit override
  // above, set once as a Preview-scoped env var, which is a deliberate act that
  // shows up in the dashboard rather than an accident of branch naming.
  if (env.VERCEL_ENV === 'production') {
    return { allowed: true, reason: 'production_deploy', host };
  }

  // Unparseable or absent connection string: treated as remote by the check
  // below, because `host` is then '(unknown)' and never a loopback name.
  // Failing closed is right here -- the cost of a wrongly-skipped local
  // migration is one manual command; the cost of a wrongly-allowed remote one
  // is this incident.
  if (LOCAL_HOSTS.has(host)) return { allowed: true, reason: 'local_target', host };

  return { allowed: false, reason: 'remote_target_without_authorization', host };
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
    `[instrumentation] REFUSING to auto-apply schema changes (boot guards AND migrations): this is not a production deploy, but DATABASE_URL points at a remote host (${host}).`,
    'A local boot silently migrated the production database on 2026-09-03; this guard exists to stop that recurring.',
    'The app will start normally and serve requests -- only the automatic schema writes are skipped.',
    'To apply deliberately: run `npm run db:migrate`, or set ALLOW_REMOTE_BOOT_MIGRATE=1 for a single run.',
  ].join(' ');
}

/**
 * The operator-facing message when the escape hatch IS used against a remote
 * database. Deliberately loud: an intentional override must leave a trace, and
 * the reason this guard exists is an unintended schema write that left none.
 */
export function overrideMessage(host: string, journalHead: string | null): string {
  return [
    `[instrumentation] ALLOW_REMOTE_BOOT_MIGRATE=1 -- applying boot guards and migrations to REMOTE host ${host}.`,
    journalHead ? `Journal head: ${journalHead}.` : 'Journal head: (unreadable).',
    'This is an explicit override; if you did not intend to write schema to this database, stop the process now.',
  ].join(' ');
}
