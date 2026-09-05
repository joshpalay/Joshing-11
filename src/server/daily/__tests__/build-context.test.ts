import { describe, expect, it } from 'vitest';

import {
  currentBuildContext,
  currentBuildId,
  noteAborted,
  noteBankAttempt,
  noteFinalSize,
  noteGatedFloorReached,
  noteGenerateCall,
  noteOutcome,
  noteQueuePersisted,
  noteRound,
  runBuildWithMetrics,
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

  it('DAILY_QUEUE_SIZE is the core-slot count the target must be written from', () => {
    // target_size no longer carries a schema DEFAULT (0137): an unwritten value
    // must be visibly NULL rather than a plausible 5, because a build landing
    // short would otherwise strand the player. This is the number the writer
    // has to derive from at persist -- core slots, never slots.length.
    expect(DAILY_QUEUE_SIZE).toBe(5);
  });

  it('keeps FOUR concurrent builds isolated, with correct per-build call attribution', async () => {
    // The daily cron fans out at USER_CONCURRENCY=4 and enters the context
    // INSIDE the per-user callback. If it were entered around the fan-out
    // instead, all four builds would share one id and A0 would have
    // reintroduced cross-build attribution error inside the very primitive
    // built to eliminate it -- and unlike the earlier clustering mistakes it
    // would NOT be catchable by reconciling against a call total, because the
    // counts would still sum correctly.
    const plan = [
      { user: 'u1', calls: 1 },
      { user: 'u2', calls: 4 },
      { user: 'u3', calls: 2 },
      { user: 'u4', calls: 3 },
    ];
    const ctxs = await Promise.all(
      plan.map(({ user, calls }) =>
        runInBuildContext(user, async (ctx) => {
          for (let i = 0; i < calls; i += 1) {
            noteGenerateCall();
            // Yield between calls so the four builds genuinely interleave.
            await new Promise((r) => setTimeout(r, 1));
          }
          return ctx;
        }),
      ),
    );

    expect(new Set(ctxs.map((c) => c.buildId)).size).toBe(4);
    expect(ctxs.map((c) => c.userId)).toEqual(['u1', 'u2', 'u3', 'u4']);
    // Attribution, not just distinctness: each build kept its OWN count.
    expect(ctxs.map((c) => c.generateCallCount)).toEqual([1, 4, 2, 3]);
  });

  it('context survives Promise.all fan-out inside a build (parallel chunks)', async () => {
    // Generation dispatches chunks via Promise.all; the id must be visible in
    // every branch or those calls write a NULL build_id and drop out of the
    // build's own statistics.
    const ctx = await runInBuildContext('u1', async (c) => {
      const ids = await Promise.all([
        Promise.resolve().then(() => currentBuildId()),
        new Promise((r) => setTimeout(r, 3)).then(() => currentBuildId()),
        Promise.resolve().then(async () => {
          await new Promise((r) => setTimeout(r, 1));
          return currentBuildId();
        }),
      ]);
      expect(ids).toEqual([c.buildId, c.buildId, c.buildId]);
      return c;
    });
    expect(ctx.buildId).toBeTruthy();
  });
});

describe('runBuildWithMetrics — the metric must survive every exit path', () => {
  it('records on the SUCCESS path', async () => {
    const recorded: string[] = [];
    await runBuildWithMetrics('u1', async () => 'ok', async (ctx) => {
      recorded.push(ctx.outcome);
    });
    expect(recorded).toEqual(['built']);
  });

  it('records on the THROWING path, and still propagates the error', async () => {
    // If the metric were written only on success, aborted and failed builds
    // would emit no row -- and the tail is the entire population Track A is
    // about. It would disappear from the data it is meant to justify.
    const recorded: string[] = [];
    const boom = new Error('generation blew up');
    await expect(
      runBuildWithMetrics(
        'u1',
        async () => {
          throw boom;
        },
        async (ctx) => {
          recorded.push(ctx.outcome);
        },
        () => 'error',
      ),
    ).rejects.toBe(boom);
    expect(recorded).toEqual(['error']);
  });

  it('classifies a known fill error rather than lumping it into error', async () => {
    const recorded: string[] = [];
    await expect(
      runBuildWithMetrics(
        'u1',
        async () => {
          throw new Error('no kb');
        },
        async (ctx) => {
          recorded.push(ctx.outcome);
        },
        () => 'no_knowledge_base',
      ),
    ).rejects.toThrow('no kb');
    expect(recorded).toEqual(['no_knowledge_base']);
  });

  it('a failing recorder never converts a successful build into a failure', async () => {
    await expect(
      runBuildWithMetrics('u1', async () => 'value', async () => {
        throw new Error('telemetry table missing');
      }),
    ).resolves.toBe('value');
  });

  it('early-return outcomes are distinguishable from genuine bank-only builds', async () => {
    // Both record zero generation calls. Without the outcome tag they would be
    // indistinguishable in the data -- the same contamination that made the
    // withdrawn "bank builds take 0.0s" figure wrong.
    const recorded: Array<{ outcome: string; calls: number }> = [];
    const capture = async (ctx: { outcome: string; generateCallCount: number }) => {
      recorded.push({ outcome: ctx.outcome, calls: ctx.generateCallCount });
    };
    await runBuildWithMetrics('u1', async () => noteOutcome('carry_forward'), capture);
    await runBuildWithMetrics('u2', async () => undefined, capture);

    expect(recorded).toEqual([
      { outcome: 'carry_forward', calls: 0 },
      { outcome: 'built', calls: 0 },
    ]);
  });
});

describe('A0a §2 — user-visible vs total span', () => {
  it('stamps userVisibleMs at persistence, and only once', async () => {
    // The deferred bonus write appends AFTER the queue is readable. If a later
    // append moved this stamp, the field would stop meaning "when could the
    // player start" and the deferral would appear to buy nothing.
    await runInBuildContext('u1', async (ctx) => {
      expect(ctx.userVisibleMs).toBeNull();
      noteQueuePersisted();
      const first = ctx.userVisibleMs;
      expect(first).not.toBeNull();
      await new Promise((r) => setTimeout(r, 15));
      noteQueuePersisted();
      expect(ctx.userVisibleMs).toBe(first);
    });
  });

  it('leaves userVisibleMs null when a build never reaches persistence', async () => {
    // A throw, or an early return on an existing queue / carry-forward. NULL
    // means "did not get there", never zero -- same rule 0137 applied to
    // target_size: an unwritten value must be visible, not plausible.
    await runInBuildContext('u2', async (ctx) => {
      expect(ctx.userVisibleMs).toBeNull();
    });
  });
});

describe('A0a §3 — rounds are phase-tagged', () => {
  it('keeps core rounds and the bonus cycle separable', async () => {
    // Untagged, these land in one series and reproduce the contamination that
    // made the earlier round analyses unusable. Tagged, the decomposition is a
    // GROUP BY.
    await runInBuildContext('u3', async (ctx) => {
      noteRound({ round: 1, phase: 'core', generationMs: 10, gateMs: 3, chunks: 2 });
      noteRound({ round: 2, phase: 'core', generationMs: 12, gateMs: 4, chunks: 1 });
      noteRound({ round: 0, phase: 'bonus', generationMs: 21, gateMs: 0, chunks: 2 });

      expect(ctx.roundCount).toBe(3);
      const core = ctx.rounds.filter((r) => r.phase === 'core');
      const bonus = ctx.rounds.filter((r) => r.phase === 'bonus');
      expect(core).toHaveLength(2);
      expect(bonus).toHaveLength(1);
      // The number the deferral is meant to move, isolated at the source.
      expect(bonus[0].generationMs).toBe(21);
      // Every span must carry a phase; an untagged one is unreadable.
      expect(ctx.rounds.every((r) => r.phase === 'core' || r.phase === 'bonus')).toBe(true);
    });
  });
});
