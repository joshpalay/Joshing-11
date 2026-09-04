import { db, dailyBuildMetrics } from '@/server/db';
import type { DailyBuildContext } from '@/server/daily/build-context';
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
 */
export async function recordDailyBuildMetric(
  ctx: DailyBuildContext,
  outcome: string,
  finalSize?: number,
): Promise<void> {
  try {
    const bankHits = ctx.bankAttempts.filter((a) => a.outcome === 'hit').length;
    await db.insert(dailyBuildMetrics).values({
      buildId: ctx.buildId,
      userId: ctx.userId,
      startedAt: new Date(ctx.startedAt),
      spanMs: Math.max(0, Date.now() - ctx.startedAt),
      roundCount: ctx.roundCount,
      generateCallCount: ctx.generateCallCount,
      rounds: ctx.rounds,
      bankHitCount: bankHits,
      bankMissCount: ctx.bankAttempts.length - bankHits,
      bankAttempts: ctx.bankAttempts,
      gatedFloorReachedMs: ctx.gatedFloorReachedMs,
      targetSize: DAILY_QUEUE_SIZE,
      finalSize: finalSize ?? 0,
      aborted: ctx.aborted,
      outcome,
    });
  } catch (error) {
    console.warn('[daily/build-metric] record failed (telemetry only)', {
      buildId: ctx.buildId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
