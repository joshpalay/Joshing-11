/**
 * Drives `items` through `worker` with at most `limit` in flight at any time.
 * Workers run in arbitrary order; failures are not isolated, so the worker
 * MUST handle its own errors (otherwise a single rejection cancels the run).
 *
 * The DB pool is capped at 5 (see src/server/db/index.ts) — keep `limit` ≤ 4
 * in callers that hold a connection per iteration so other work in the same
 * process isn't starved.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const cappedLimit = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  const runners = Array.from({ length: cappedLimit }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}
