import { describe, expect, it } from 'vitest';

import {
  decideBootSchemaWrite,
  hostFromConnectionString,
  overrideMessage,
  refusalMessage,
} from '@/server/db/migrate-safety';

const LOCAL = 'postgresql://user:pw@localhost:5432/joshing';
const REMOTE = 'postgresql://user:pw@db.abcdefg.supabase.co:5432/postgres';

describe('boot schema-write safety gate', () => {
  it('REFUSES a remote target from a local process — the 2026-09-03 incident', () => {
    // A `npm run dev` boot applied migration 0136 to production because this
    // repo's local .env DATABASE_URL points at prod. This is the exact case.
    const decision = decideBootSchemaWrite(REMOTE, {});
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('remote_target_without_authorization');
    expect(decision.host).toBe('db.abcdefg.supabase.co');
  });

  it('does not consult NODE_ENV — the incident happened under NODE_ENV=development', () => {
    // The environment NAME was never what made it dangerous; the connection
    // TARGET was. Passing no env at all must still refuse a remote host.
    expect(decideBootSchemaWrite(REMOTE, {}).allowed).toBe(false);
  });

  it('allows a local target', () => {
    const decision = decideBootSchemaWrite(LOCAL, {});
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('local_target');
  });

  it.each(['127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal'])(
    'treats %s as local',
    (host) => {
      // IPv6 literals must be bracketed to form a valid URL.
      const authority = host.includes(':') ? `[${host}]` : host;
      expect(decideBootSchemaWrite(`postgresql://u:p@${authority}:5432/db`, {}).allowed).toBe(true);
    },
  );

  it('allows a PRODUCTION deploy — production must migrate exactly as before', () => {
    const decision = decideBootSchemaWrite(REMOTE, { VERCEL_ENV: 'production' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('production_deploy');
  });

  it('REFUSES a preview deploy — VERCEL is set on previews too', () => {
    // The hole this closes: keying on the presence of VERCEL would let any
    // branch that gets a preview deploy write schema to whatever DATABASE_URL
    // that environment resolves to. If preview shares the production string,
    // that is the incident again, sourced from CI instead of a laptop.
    expect(decideBootSchemaWrite(REMOTE, { VERCEL_ENV: 'preview' }).allowed).toBe(false);
    expect(decideBootSchemaWrite(REMOTE, { VERCEL_ENV: 'development' }).allowed).toBe(false);
  });

  it('allows an explicit single-run override', () => {
    const decision = decideBootSchemaWrite(REMOTE, { ALLOW_REMOTE_BOOT_MIGRATE: '1' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('explicit_override');
  });

  it('lets a preview deploy opt in explicitly, so a separate preview DB still migrates', () => {
    const decision = decideBootSchemaWrite(REMOTE, {
      VERCEL_ENV: 'preview',
      ALLOW_REMOTE_BOOT_MIGRATE: '1',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('explicit_override');
  });

  it('only "1" opts in — a truthy-looking value must not', () => {
    expect(decideBootSchemaWrite(REMOTE, { ALLOW_REMOTE_BOOT_MIGRATE: 'true' }).allowed).toBe(false);
    expect(decideBootSchemaWrite(REMOTE, { ALLOW_REMOTE_BOOT_MIGRATE: '0' }).allowed).toBe(false);
  });

  it('FAILS CLOSED on an absent or unparseable connection string', () => {
    // One manual command is the cost of a wrongly-skipped local migration.
    // A wrongly-allowed remote one is the incident this guard exists for.
    expect(decideBootSchemaWrite(undefined, {}).allowed).toBe(false);
    expect(decideBootSchemaWrite('not-a-url', {}).allowed).toBe(false);
  });

  it('never puts credentials in an operator-facing message', () => {
    const host = hostFromConnectionString(REMOTE) ?? '(unknown)';
    for (const message of [refusalMessage(host), overrideMessage(host, '0137_target_size')]) {
      expect(message).toContain('db.abcdefg.supabase.co');
      expect(message).not.toContain('pw');
      expect(message).not.toContain('user:');
    }
  });

  it('the refusal names the way out, so nobody has to go looking', () => {
    const message = refusalMessage('db.abcdefg.supabase.co');
    expect(message).toContain('npm run db:migrate');
    expect(message).toContain('ALLOW_REMOTE_BOOT_MIGRATE=1');
  });

  it('an intentional override is LOUD — the incident left no trace', () => {
    const message = overrideMessage('db.abcdefg.supabase.co', '0137_target_size');
    expect(message).toContain('REMOTE');
    expect(message).toContain('db.abcdefg.supabase.co');
    expect(message).toContain('0137_target_size');
  });

  it('extracts host without credentials', () => {
    expect(hostFromConnectionString(REMOTE)).toBe('db.abcdefg.supabase.co');
    expect(hostFromConnectionString('garbage')).toBeNull();
    expect(hostFromConnectionString(undefined)).toBeNull();
  });
});
