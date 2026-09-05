import { db, dailyBuildMetrics } from '@/server/db';
import type { DailyBuildContext } from '@/server/daily/build-context';
import { BONUS_MARKER_FLOOR } from '@/server/daily/bonus';
import { DAILY_QUEUE_SIZE } from '@/server/daily/types';

/**
 * Persist one row per Daily Five build (A0).
 *
 * Observational only — nothing in the serving path reads this table. It exists
 * so the A1/A2 decisions can be made against measured numbers rather than
 * numbers reconstructed by clustering `LlmUsageEvent` on timestamps, which was
 * wrong three separate ways (a one-day batch sweep read as build traffic;
 * overlapping lookback windows double-counting the ~36% of queues the cron
 * builds back-to-back; and a circular "0.0s" for builds that make no LLM calls).
 *
 * Swallows its own errors: a telemetry failure must never convert a successful
 * build into a failed one.
 *
 * READING THE ROUNDS ARRAY. Every span carries a `phase` ('core' | 'bonus') set
 * at its call site. Do NOT aggregate across phases: an untagged series mixes
 * critical-path core rounds with the bonus cycle and reproduces exactly the
 * contamination that made the earlier round analyses unusable. GROUP BY phase.
 *
 * READING ANY CORE/BONUS FIGURE. Bonus-ness is marker-based and the marker did
 * not exist before BONUS_MARKER_FLOOR (2026-06-04) — 38% of historical queues
 * predate it and classify as all-core with nothing in the data saying so. Rows
 * in THIS table are all post-floor by construction, so its own metrics are
 * safe; the floor is re-exported for anything joining back to historical
 * DailyQueue rows.
 */
export { BONUS_MARKER_FLOOR };
/**
 * PHASE 1 -- called immediately after the queue is persisted and readable.
 *
 * Writes the row with user_visible_ms set and span_ms NULL. The row therefore
 * exists from the moment the player can start, which matters because phase 2
 * runs in a scheduled continuation that is not guaranteed to complete: a
 * serverless freeze after the response, a throw in bonus generation, or a
 * caller where after() never runs. Writing only in the continuation would leave
 * no row at all, which is ambiguous between "the build never happened" and "the
 * continuation was lost". A NULL span_ms says exactly which.
 *
 * Idempotent on build_id -- a retried insert is a no-op, never a duplicate row.
 */
export async function insertDailyBuildMetric(ctx: DailyBuildContext): Promise<void> {
  try {
    const bankHits = ctx.bankAttempts.filter((a) => a.outcome === 'hit').length;
    await db
      .insert(dailyBuildMetrics)
      .values({
        buildId: ctx.buildId,
        userId: ctx.userId,
        startedAt: new Date(ctx.startedAt),
        // Deliberately NOT set here. Phase 2 owns total time.
        spanMs: null,
        userVisibleMs: ctx.userVisibleMs,
        deferred: ctx.deferred,
        borrowedDomainCount: ctx.borrowedDomainCount,
        deferredDomainCount: ctx.deferredDomainCount,
        roundCount: ctx.roundCount,
        generateCallCount: ctx.generateCallCount,
        rounds: ctx.rounds,
        bankHitCount: bankHits,
        bankMissCount: ctx.bankAttempts.length - bankHits,
        bankAttempts: ctx.bankAttempts,
        gatedFloorReachedMs: ctx.gatedFloorReachedMs,
        targetSize: DAILY_QUEUE_SIZE,
        finalSize: ctx.finalSize,
        aborted: ctx.aborted,
        outcome: ctx.outcome,
      })
      .onConflictDoNothing();
  } catch (error) {
    console.warn('[daily/build-metric] insert failed (telemetry only)', {
      buildId: ctx.buildId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * PHASE 2 -- called when ALL work for the build is done, deferred bonus
 * included. Sets span_ms (total, including work moved off the critical path)
 * and re-writes the counters the continuation may have advanced.
 *
 * Upserts rather than updates: an early-return or a build that threw before
 * persisting never ran phase 1, and those rows must still exist. Analysis MUST
 * filter on outcome='built' -- the early-return paths record zero generation
 * calls and would otherwise be indistinguishable from a genuine bank-only
 * build.
 */
export async function finalizeDailyBuildMetric(ctx: DailyBuildContext): Promise<void> {
  try {
    const bankHits = ctx.bankAttempts.filter((a) => a.outcome === 'hit').length;
    const spanMs = Math.max(0, Date.now() - ctx.startedAt);
    const shared = {
      spanMs,
      userVisibleMs: ctx.userVisibleMs,
      deferred: ctx.deferred,
      borrowedDomainCount: ctx.borrowedDomainCount,
      deferredDomainCount: ctx.deferredDomainCount,
      roundCount: ctx.roundCount,
      generateCallCount: ctx.generateCallCount,
      rounds: ctx.rounds,
      bankHitCount: bankHits,
      bankMissCount: ctx.bankAttempts.length - bankHits,
      bankAttempts: ctx.bankAttempts,
      gatedFloorReachedMs: ctx.gatedFloorReachedMs,
      finalSize: ctx.finalSize,
      aborted: ctx.aborted,
      outcome: ctx.outcome,
    };
    await db
      .insert(dailyBuildMetrics)
      .values({
        buildId: ctx.buildId,
        userId: ctx.userId,
        startedAt: new Date(ctx.startedAt),
        targetSize: DAILY_QUEUE_SIZE,
        ...shared,
      })
      .onConflictDoUpdate({ target: dailyBuildMetrics.buildId, set: shared });
  } catch (error) {
    console.warn('[daily/build-metric] finalize failed (telemetry only)', {
      buildId: ctx.buildId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
