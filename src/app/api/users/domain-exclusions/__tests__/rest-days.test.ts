import { afterEach, describe, expect, it, vi } from 'vitest';

// getDomainRestDays reads process.env at call time, so it's testable without a
// DB. Route module imports pull in @/server/db (no connection string in tests),
// so stub it to a no-op shape — we only exercise the pure config helper.
vi.mock('@/server/db', () => ({ db: {}, userDomainExclusions: {} }));
vi.mock('@/server/auth/session', () => ({ getSession: vi.fn() }));

import { getDomainRestDays } from '@/app/api/users/domain-exclusions/route';

const ORIGINAL = process.env.DOMAIN_REST_DAYS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DOMAIN_REST_DAYS;
  else process.env.DOMAIN_REST_DAYS = ORIGINAL;
});

describe('getDomainRestDays', () => {
  it('defaults to 21 when unset', () => {
    delete process.env.DOMAIN_REST_DAYS;
    expect(getDomainRestDays()).toBe(21);
  });

  it('honors a positive override', () => {
    process.env.DOMAIN_REST_DAYS = '30';
    expect(getDomainRestDays()).toBe(30);
  });

  it('falls back to 21 for non-numeric, zero, or negative values', () => {
    for (const bad of ['abc', '0', '-5', '']) {
      process.env.DOMAIN_REST_DAYS = bad;
      expect(getDomainRestDays()).toBe(21);
    }
  });
});
