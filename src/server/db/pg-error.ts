// Drizzle wraps pg driver errors in a DrizzleQueryError whose own `.code` /
// `.message` describe the wrapper, not the underlying Postgres failure. The
// real pg error (with `.code` like '42P01' or '42703') sits on `.cause`. These
// helpers normalize lookups so resilience checks work regardless of whether
// the error has been wrapped.

export function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { code?: unknown; cause?: unknown };
  const causeCode = (e.cause as { code?: unknown } | undefined)?.code;
  if (typeof causeCode === 'string') return causeCode;
  if (typeof e.code === 'string') return e.code;
  return undefined;
}

export function pgErrorMessage(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { message?: unknown; cause?: unknown };
  const causeMsg = (e.cause as { message?: unknown } | undefined)?.message;
  if (typeof causeMsg === 'string' && causeMsg) return causeMsg;
  if (typeof e.message === 'string') return e.message;
  return undefined;
}
