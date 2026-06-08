import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextRequest } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';

function requestWithHeaders(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

describe('isCronAuthorized', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.VERCEL_CRON_SECRET;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('fails CLOSED when no secret is configured (the bug fix)', () => {
    // No CRON_SECRET / VERCEL_CRON_SECRET set. Previously this returned true,
    // making the route publicly triggerable. It must now deny.
    expect(isCronAuthorized(requestWithHeaders({}))).toBe(false);
    expect(isCronAuthorized(requestWithHeaders({ authorization: 'Bearer anything' }))).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('treats a whitespace-only secret as unset and fails closed', () => {
    process.env.CRON_SECRET = '   ';
    expect(isCronAuthorized(requestWithHeaders({ authorization: 'Bearer    ' }))).toBe(false);
  });

  it('accepts the matching Authorization: Bearer header', () => {
    process.env.CRON_SECRET = 's3cr3t';
    expect(isCronAuthorized(requestWithHeaders({ authorization: 'Bearer s3cr3t' }))).toBe(true);
  });

  it('accepts the cron_secret and x-cron-secret header forms', () => {
    process.env.CRON_SECRET = 's3cr3t';
    expect(isCronAuthorized(requestWithHeaders({ cron_secret: 's3cr3t' }))).toBe(true);
    expect(isCronAuthorized(requestWithHeaders({ 'x-cron-secret': 's3cr3t' }))).toBe(true);
  });

  it('rejects a wrong or missing secret when one is configured', () => {
    process.env.CRON_SECRET = 's3cr3t';
    expect(isCronAuthorized(requestWithHeaders({ authorization: 'Bearer nope' }))).toBe(false);
    expect(isCronAuthorized(requestWithHeaders({}))).toBe(false);
  });

  it('falls back to VERCEL_CRON_SECRET when CRON_SECRET is unset', () => {
    process.env.VERCEL_CRON_SECRET = 'vercel-secret';
    expect(isCronAuthorized(requestWithHeaders({ authorization: 'Bearer vercel-secret' }))).toBe(true);
    expect(isCronAuthorized(requestWithHeaders({ authorization: 'Bearer nope' }))).toBe(false);
  });
});
