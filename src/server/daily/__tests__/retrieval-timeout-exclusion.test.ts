import { beforeAll, describe, expect, it } from 'vitest';

// retrieval-grounded imports @/server/db, which throws at module load without a
// connection string. isTimeoutError is pure; a dummy URL + dynamic import (repo
// convention) keeps the unit pure without a DB.
let mod: typeof import('@/server/daily/retrieval-grounded');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/daily/retrieval-grounded');
});

describe('isTimeoutError', () => {
  it('classifies the real per-call abort (AbortSignal.timeout) as a timeout', () => {
    // Shape observed in prod logs: name "Error", message "Request was aborted."
    expect(mod.isTimeoutError({ name: 'Error', message: 'Request was aborted.' })).toBe(true);
    expect(mod.isTimeoutError(new Error('Request was aborted.'))).toBe(true);
  });

  it('classifies AbortError / TimeoutError by name', () => {
    expect(mod.isTimeoutError({ name: 'AbortError', message: 'The operation was aborted' })).toBe(true);
    expect(mod.isTimeoutError({ name: 'TimeoutError', message: 'signal timed out' })).toBe(true);
  });

  it('classifies "timed out" / "timeout" messages as timeouts', () => {
    expect(mod.isTimeoutError(new Error('Request timed out after 120000ms'))).toBe(true);
    expect(mod.isTimeoutError(new Error('socket timeout'))).toBe(true);
  });

  it('does NOT classify non-timeout API/parse errors as timeouts', () => {
    expect(mod.isTimeoutError(new Error('400 invalid_request_error: bad params'))).toBe(false);
    expect(mod.isTimeoutError(new Error('Unexpected token in JSON'))).toBe(false);
    expect(mod.isTimeoutError({ name: 'TypeError', message: 'x is not a function' })).toBe(false);
  });

  it('is safe on null / undefined / odd shapes', () => {
    expect(mod.isTimeoutError(null)).toBe(false);
    expect(mod.isTimeoutError(undefined)).toBe(false);
    expect(mod.isTimeoutError('some random failure')).toBe(false); // bare string, no timeout words
    expect(mod.isTimeoutError({})).toBe(false);
  });
});
