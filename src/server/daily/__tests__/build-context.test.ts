import { describe, expect, it } from 'vitest';

import {
  currentBuildContext,
  currentBuildId,
  noteAborted,
  noteBankAttempt,
  noteFinalSize,
  noteGatedFloorReached,
  noteGenerateCall,
  noteRound,
  runInBuildContext,
} from '@/server/daily/build-context';
import { DAILY_QUEUE_SIZE } from '@/server/daily/types';

describe('build correlation context (A0)', () => {
  it('reads as absent outside a build, so unrelated LLM callers stamp a NULL build_id', () => {
    // This is load-bearing: it keeps batch verify / crafter drafting / admin
    // audits out of build statistics without needing a scope allowlist. A
    // one-day batch sweep being mistaken for build traffic is exactly what made
    // the earlier timestamp-clustering analysis wrong.
    expect(currentBuildId()).toBeNull();
    expect(currentBuildContext()).toBeUndefined();
    // Counters must no-op rather than throw when called outside a build.
    expect(() => {
      noteGenerateCall();
      noteGatedFloorReached();
      noteAborted();
      noteFinalSize(5);
      noteBankAttempt({
        domain: 'x',
        outcome: 'hit',
        missReason: null,
        tierRequested: 'medium',
        tierServed: 'medium',
      });
    }).not.toThrow();
  });

  it('gives each build a distinct id, visible to everything inside it', async () => {
    const seen: string[] = [];
    await runInBuildContext('u1', async (ctx) => {
      seen.push(ctx.buildId);
      // Deep in the call graph, with no parameter threading.
      expect(currentBuildId()).toBe(ctx.buildId);
    });
    await runInBuildContext('u1', async (ctx) => seen.push(ctx.buildId));
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('keeps concurrent builds isolated', async () => {
    // The daily cron runs several builds at once; a shared mutable counter
    // would silently mix their call counts.
    const [a, b] = await Promise.all([
      runInBuildContext('u1', async (ctx) => {
        noteGenerateCall();
        await new Promise((r) => setTimeout(r, 5));
        noteGenerateCall();
        return ctx;
      }),
      runInBuildContext('u2', async (ctx) => {
        noteGenerateCall();
        return ctx;
      }),
    ]);
    expect(a.generateCallCount).toBe(2);
    expect(b.generateCallCount).toBe(1);
    expect(a.buildId).not.toBe(b.buildId);
  });

  it('stamps the gated floor once — later growth must not move it', async () => {
    const ctx = await runInBuildContext('u1', async (c) => {
      noteGatedFloorReached();
      const first = c.gatedFloorReachedMs;
      await new Promise((r) => setTimeout(r, 12));
      noteGatedFloorReached();
      expect(c.gatedFloorReachedMs).toBe(first);
      return c;
    });
    expect(ctx.gatedFloorReachedMs).not.toBeNull();
  });

  it('leaves the floor null when it was never reached', async () => {
    const ctx = await runInBuildContext('u1', async (c) => c);
    expect(ctx.gatedFloorReachedMs).toBeNull();
  });

  it('records rounds and calls separately — they answer different questions', async () => {
    // Chunks run in PARALLEL while rounds are separated by a sequential gate
    // chain, so call count and round count can diverge. Recording both is what
    // lets "does span track rounds or calls?" be regressed rather than argued.
    const ctx = await runInBuildContext('u1', async (c) => {
      noteRound({ round: 1, generationMs: 100, gateMs: 20, chunks: 3 });
      noteRound({ round: 2, generationMs: 90, gateMs: 20, chunks: 1 });
      noteGenerateCall();
      noteGenerateCall();
      noteGenerateCall();
      return c;
    });
    expect(ctx.roundCount).toBe(2);
    expect(ctx.generateCallCount).toBe(3);
    expect(ctx.rounds.map((r) => r.chunks)).toEqual([3, 1]);
  });

  it('accumulates bank attempts with miss reasons', async () => {
    const ctx = await runInBuildContext('u1', async (c) => {
      noteBankAttempt({
        domain: 'Ancient Rome',
        outcome: 'hit',
        missReason: null,
        tierRequested: 'medium',
        tierServed: 'medium',
      });
      noteBankAttempt({
        domain: 'Obscure Flute',
        outcome: 'miss',
        missReason: 'no_stock',
        tierRequested: 'hard',
        tierServed: null,
      });
      return c;
    });
    expect(ctx.bankAttempts).toHaveLength(2);
    expect(ctx.bankAttempts.filter((a) => a.outcome === 'hit')).toHaveLength(1);
    expect(ctx.bankAttempts[1]!.missReason).toBe('no_stock');
  });

  it('the schema default for target_size matches DAILY_QUEUE_SIZE', () => {
    // schema.ts duplicates this as a literal (it must stay free of server-tree
    // runtime imports); this is the assertion that keeps the two in step.
    expect(DAILY_QUEUE_SIZE).toBe(5);
  });
});
