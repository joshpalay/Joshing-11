import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isAdminUser } from '@/server/auth/admin';

const ORIGINAL = process.env.ADMIN_USER_IDS;

beforeEach(() => {
  delete process.env.ADMIN_USER_IDS;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_USER_IDS;
  else process.env.ADMIN_USER_IDS = ORIGINAL;
});

describe('isAdminUser', () => {
  it('denies everyone when ADMIN_USER_IDS is unset (safe default)', () => {
    expect(isAdminUser('user-1')).toBe(false);
  });

  it('denies a null/empty user id', () => {
    process.env.ADMIN_USER_IDS = 'user-1';
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
    expect(isAdminUser('')).toBe(false);
  });

  it('admits a listed id and denies an unlisted one (comma-separated, whitespace-tolerant)', () => {
    process.env.ADMIN_USER_IDS = ' user-1 , user-2 ';
    expect(isAdminUser('user-1')).toBe(true);
    expect(isAdminUser('user-2')).toBe(true);
    expect(isAdminUser('user-3')).toBe(false);
  });

  it('denies when the env is blank', () => {
    process.env.ADMIN_USER_IDS = '   ';
    expect(isAdminUser('user-1')).toBe(false);
  });
});
