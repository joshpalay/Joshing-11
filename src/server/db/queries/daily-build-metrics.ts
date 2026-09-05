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
export async function recordDailyBuildMetric(ctx: DailyBuildContext): Promise<void> {
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
      // §2: the player-visible half of the span. Compare against spanMs on the
      // same row to price the bonus deferral; see the column comment.
      userVisibleMs: ctx.userVisibleMs,
      targetSize: DAILY_QUEUE_SIZE,
      finalSize: ctx.finalSize,
      aborted: ctx.aborted,
      // Analysis MUST filter on outcome='built'. The early-return paths
      // (existing queue, carry-forward, partial carry-forward) record zero
      // generation calls and would otherwise be indistinguishable from a
      // genuine bank-only build.
      outcome: ctx.outcome,
    });
  } catch (error) {
    console.warn('[daily/build-metric] record failed (telemetry only)', {
      buildId: ctx.buildId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
