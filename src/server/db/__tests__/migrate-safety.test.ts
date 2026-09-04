import { describe, expect, it } from 'vitest';

import {
  decideBootMigrate,
  hostFromConnectionString,
  refusalMessage,
} from '@/server/db/migrate-safety';

const LOCAL = 'postgresql://user:pw@localhost:5432/joshing';
const REMOTE = 'postgresql://user:pw@db.abcdefg.supabase.co:5432/postgres';

describe('boot-migrate safety gate', () => {
  it('REFUSES a remote target from a local process — the 2026-09-03 incident', () => {
    // A `npm run dev` boot applied migration 0136 to production because this
    // repo's local .env DATABASE_URL points at prod. This is the exact case.
    const decision = decideBootMigrate(REMOTE, {});
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('remote_target_from_local_process');
      expect(decision.host).toBe('db.abcdefg.supabase.co');
    }
  });

  it('does not consult NODE_ENV — the incident happened under NODE_ENV=development', () => {
    // The environment NAME was never what made it dangerous; the connection
    // TARGET was. Passing no env at all must still refuse a remote host.
    expect(decideBootMigrate(REMOTE, {}).allowed).toBe(false);
  });

  it('allows a local target', () => {
    const decision = decideBootMigrate(LOCAL, {});
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.reason).toBe('local_target');
  });

  it.each(['127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal'])(
    'treats %s as local',
    (host) => {
      // IPv6 literals must be bracketed to form a valid URL.
      const authority = host.includes(':') ? `[${host}]` : host;
      expect(decideBootMigrate(`postgresql://u:p@${authority}:5432/db`, {}).allowed).toBe(true);
    },
  );

  it('allows a deploy platform — production deploys must migrate exactly as before', () => {
    const decision = decideBootMigrate(REMOTE, { VERCEL: '1' });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.reason).toBe('deploy_platform');
  });

  it('allows an explicit single-run override', () => {
    const decision = decideBootMigrate(REMOTE, { ALLOW_REMOTE_BOOT_MIGRATE: '1' });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.reason).toBe('explicit_override');
  });

  it('only "1" opts in — a truthy-looking value must not', () => {
    expect(decideBootMigrate(REMOTE, { ALLOW_REMOTE_BOOT_MIGRATE: 'true' }).allowed).toBe(false);
    expect(decideBootMigrate(REMOTE, { ALLOW_REMOTE_BOOT_MIGRATE: '0' }).allowed).toBe(false);
  });

  it('FAILS CLOSED on an absent or unparseable connection string', () => {
    // One manual command is the cost of a wrongly-skipped local migration.
    // A wrongly-allowed remote one is the incident this guard exists for.
    expect(decideBootMigrate(undefined, {}).allowed).toBe(false);
    expect(decideBootMigrate('not-a-url', {}).allowed).toBe(false);
  });

  it('never puts credentials in the refusal message', () => {
    const message = refusalMessage(hostFromConnectionString(REMOTE) ?? '(unknown)');
    expect(message).toContain('db.abcdefg.supabase.co');
    expect(message).not.toContain('pw');
    expect(message).not.toContain('user:');
    // It must also name the way out, so nobody has to go looking.
    expect(message).toContain('npm run db:migrate');
    expect(message).toContain('ALLOW_REMOTE_BOOT_MIGRATE=1');
  });

  it('extracts host without credentials', () => {
    expect(hostFromConnectionString(REMOTE)).toBe('db.abcdefg.supabase.co');
    expect(hostFromConnectionString('garbage')).toBeNull();
    expect(hostFromConnectionString(undefined)).toBeNull();
  });
});
