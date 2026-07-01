import { describe, expect, it } from 'vitest';

import { runBudgetedConcurrent } from '@/server/daily/budgeted-concurrency';

const ITEMS = ['a', 'b', 'c', 'd', 'e', 'f'];
const okResult = (usd: number) => ({ usd });
const errResult = () => ({ usd: 0, failed: true });

describe('runBudgetedConcurrent', () => {
  it('processes every item when the budget allows, with zero backlog', async () => {
    const { results, backlog } = await runBudgetedConcurrent(
      ITEMS,
      { concurrency: 3, perItemReservation: 0.03, ceiling: 100, costOf: (r) => r.usd },
      async () => okResult(0.1),
      errResult,
    );
    expect(results).toHaveLength(ITEMS.length);
    expect(backlog).toBe(0);
  });

  it('never exceeds the concurrency cap in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    await runBudgetedConcurrent(
      ITEMS,
      { concurrency: 2, perItemReservation: 0, ceiling: 100, costOf: (r) => r.usd },
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return okResult(0.1);
      },
      errResult,
    );
    expect(peak).toBe(2);
  });

  it('stops launching at the budget ceiling and reports the unserved backlog', async () => {
    // ceiling 0.25, each item commits 0.10, reservation 0.10 → guard blocks once
    // committed reaches 0.20 (0.20 + 0.10 > 0.25). So 2 items run, 4 are backlog.
    const ran: string[] = [];
    const { results, backlog } = await runBudgetedConcurrent(
      ITEMS,
      { concurrency: 1, perItemReservation: 0.1, ceiling: 0.25, costOf: (r) => r.usd },
      async (item) => {
        ran.push(item);
        return okResult(0.1);
      },
      errResult,
    );
    expect(results).toHaveLength(2);
    expect(ran).toEqual(['a', 'b']);
    expect(backlog).toBe(4);
  });

  it('overshoots the ceiling by at most concurrency × reservation', async () => {
    // With concurrency 3 and reservation 0.10, up to 3 calls launch before any
    // commits, so the run may process ceiling/reservation + (concurrency-1) items.
    const { results } = await runBudgetedConcurrent(
      ITEMS,
      { concurrency: 3, perItemReservation: 0.1, ceiling: 0.1, costOf: (r) => r.usd },
      async () => {
        // Hold all three workers until they have all claimed an item.
        await new Promise((r) => setTimeout(r, 5));
        return okResult(0.1);
      },
      errResult,
    );
    // ceiling fits exactly 1 by reservation, but up to concurrency launch together.
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('maps a rejected item to onError and keeps processing the rest', async () => {
    const { results } = await runBudgetedConcurrent(
      ITEMS,
      { concurrency: 2, perItemReservation: 0, ceiling: 100, costOf: (r) => r.usd },
      async (item) => {
        if (item === 'c') throw new Error('boom');
        return okResult(0.1);
      },
      () => errResult(),
    );
    expect(results).toHaveLength(ITEMS.length);
    expect(results.filter((r) => 'failed' in r && r.failed)).toHaveLength(1);
  });

  it('a slow item does not stall the others (faster workers drain the queue)', async () => {
    const completionOrder: string[] = [];
    await runBudgetedConcurrent(
      ['slow', 'f1', 'f2', 'f3'],
      { concurrency: 2, perItemReservation: 0, ceiling: 100, costOf: (r) => r.usd },
      async (item) => {
        await new Promise((r) => setTimeout(r, item === 'slow' ? 50 : 2));
        completionOrder.push(item);
        return okResult(0);
      },
      errResult,
    );
    // The slow item starts first but finishes last; the fast ones complete while
    // it is still running, proving the second worker kept pulling.
    expect(completionOrder[completionOrder.length - 1]).toBe('slow');
    expect(completionOrder.slice(0, 3).sort()).toEqual(['f1', 'f2', 'f3']);
  });

  it('degrades to sequential at concurrency 1', async () => {
    let inFlight = 0;
    let peak = 0;
    await runBudgetedConcurrent(
      ITEMS,
      { concurrency: 1, perItemReservation: 0, ceiling: 100, costOf: (r) => r.usd },
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight -= 1;
        return okResult(0);
      },
      errResult,
    );
    expect(peak).toBe(1);
  });

  it('handles an empty item list without launching work', async () => {
    let calls = 0;
    const { results, backlog } = await runBudgetedConcurrent(
      [] as string[],
      { concurrency: 4, perItemReservation: 0.1, ceiling: 1, costOf: (r) => r.usd },
      async () => {
        calls += 1;
        return okResult(0.1);
      },
      errResult,
    );
    expect(calls).toBe(0);
    expect(results).toHaveLength(0);
    expect(backlog).toBe(0);
  });

  it('calls onSettle once per item with its settled result (survives a mid-run kill)', async () => {
    const settled: Array<{ item: string; usd: number }> = [];
    await runBudgetedConcurrent(
      ['a', 'b', 'c'],
      { concurrency: 2, perItemReservation: 0, ceiling: 100, costOf: (r) => r.usd },
      async (item) => okResult(item === 'b' ? 0.2 : 0.1),
      errResult,
      (item, result) => {
        // Fires per item as it settles — so on an abrupt caller timeout, the items
        // that already settled have been recorded even though the run never returns.
        settled.push({ item, usd: result.usd });
      },
    );
    expect(settled).toHaveLength(3);
    expect(settled.map((s) => s.item).sort()).toEqual(['a', 'b', 'c']);
    expect(settled.find((s) => s.item === 'b')?.usd).toBe(0.2);
  });

  it('onSettle receives the onError-mapped result for a failed item', async () => {
    const settled: Array<{ item: string; failed: boolean }> = [];
    await runBudgetedConcurrent(
      ['ok', 'boom'],
      { concurrency: 2, perItemReservation: 0, ceiling: 100, costOf: (r) => r.usd },
      async (item) => {
        if (item === 'boom') throw new Error('kaboom');
        return okResult(0.1);
      },
      () => errResult(),
      (item, result) => {
        settled.push({ item, failed: 'failed' in result && result.failed === true });
      },
    );
    expect(settled.find((s) => s.item === 'boom')?.failed).toBe(true);
    expect(settled.find((s) => s.item === 'ok')?.failed).toBe(false);
  });

  it('a throwing onSettle never sinks the run', async () => {
    const { results } = await runBudgetedConcurrent(
      ITEMS,
      { concurrency: 3, perItemReservation: 0, ceiling: 100, costOf: (r) => r.usd },
      async () => okResult(0.1),
      errResult,
      () => {
        throw new Error('onSettle blew up');
      },
    );
    expect(results).toHaveLength(ITEMS.length);
  });
});
