// Generic bounded-concurrency runner with a USD-style budget guard
// (B-SUPPLY-REFILL-THROUGHPUT-01). Pure — no db / network / env — so it is unit
// testable in isolation. Used by the pool-refill cron, where each item is a
// domain whose grounded web-search call runs 60-120s: a SEQUENTIAL run drained
// only ~2-3 items inside the route's 300s budget (verification 2026-06-30, ~65%
// of items timed out), so we process a few at once.
//
// Guard semantics: a worker launches the next item only while
// `committed + perItemReservation <= ceiling`, where `committed` is the running
// sum of each settled result's cost. With up to `concurrency` calls in flight,
// the total can overshoot the ceiling by at most `concurrency × perItemReservation`
// — bounded and accepted (callers keep a hard monthly backstop above this). A
// worker that finishes a cheap/fast item immediately pulls the next, so a slow
// item never stalls the others.

export type BudgetedRunResult<R> = {
  /** Settled results, in completion order. */
  results: R[];
  /** Items never launched because the ceiling was reached (unserved demand). */
  backlog: number;
};

export async function runBudgetedConcurrent<T, R>(
  items: readonly T[],
  opts: {
    /** Max items in flight at once (floored at 1). */
    concurrency: number;
    /** Stop launching once committed + this would cross the ceiling. */
    perItemReservation: number;
    /** Budget ceiling in the same unit as perItemReservation / costOf. */
    ceiling: number;
    /** Actual cost of a settled result, added to committed spend. */
    costOf: (result: R) => number;
  },
  run: (item: T) => Promise<R>,
  onError: (item: T, err: unknown) => R,
): Promise<BudgetedRunResult<R>> {
  const results: R[] = [];
  let committed = 0;
  let nextIndex = 0;
  let backlog = 0;
  let ceilingHit = false;

  const worker = async (): Promise<void> => {
    while (true) {
      // Claim the next item under the budget guard. There is no await between the
      // guard and the index bump, so the check-and-claim is atomic on the JS thread.
      if (nextIndex >= items.length) return;
      if (committed + opts.perItemReservation > opts.ceiling) {
        if (!ceilingHit) {
          ceilingHit = true;
          backlog = items.length - nextIndex;
        }
        return;
      }
      const item = items[nextIndex];
      nextIndex += 1;
      let result: R;
      try {
        result = await run(item);
      } catch (err) {
        result = onError(item, err);
      }
      committed += opts.costOf(result);
      results.push(result);
    }
  };

  const workerCount = Math.max(1, Math.min(Math.floor(opts.concurrency) || 1, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { results, backlog };
}
