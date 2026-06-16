import { after } from 'next/server';

import { logLatency } from '@/server/telemetry';

/**
 * Fire-and-forget pre-warm of a user's Daily Five queue.
 *
 * Scheduled via next/server `after()` so it runs AFTER the response is flushed:
 * the caller (login, onboarding completion) returns immediately and the
 * seconds-long Sonnet generation happens in the background. By the time the
 * player reaches `/daily`, the queue is already built — so they never wait at
 * the loading screen for work that could have happened while they were still
 * reading the welcome screen.
 *
 * Safe to call redundantly. `fillDailyQueueForUser` is idempotent (it
 * early-returns when today's queue already exists / carries an unplayed one
 * forward) and `persistDailyQueue` writes through a `(userId, queueDate)`
 * upsert — so a pre-warm racing the daily cron or the page-load POST cannot
 * create a duplicate or partial queue. The only cost of a lost race is one
 * re-billed build; the player is never blocked because the `/daily` POST is the
 * synchronous fallback for every case this misses.
 *
 * The Daily Five orchestrator (and its DB query graph) is imported LAZILY inside
 * the deferred callback rather than at module top level, so the hot auth /
 * onboarding routes that schedule a pre-warm don't pull that whole graph into
 * their own module graph at import time. It's only loaded when a pre-warm
 * actually runs — at request time, when `@/server/db` is already initialized.
 *
 * IMPORTANT: the route that calls this MUST set `maxDuration` high enough for a
 * full build (90s, matching `/api/daily/queue`). On Vercel, `after()` work
 * counts toward the function's duration budget, so the default ceiling would
 * kill generation mid-flight.
 */
export function prewarmDailyQueue(userId: string, trigger: 'login' | 'onboarding'): void {
  try {
    after(async () => {
      const startedAt = Date.now();
      const orchestrator = await import('@/server/daily/queue-orchestrator').catch((error) => {
        console.error('[daily/prewarm] failed to load orchestrator', {
          userId,
          trigger,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      if (!orchestrator) return;

      try {
        await orchestrator.fillDailyQueueForUser(userId);
        logLatency('daily_queue_prewarm', Date.now() - startedAt, { trigger, outcome: 'ok' });
      } catch (error) {
        // `no_knowledge_base` is benign — there's simply nothing to build from yet
        // (e.g. a brand-new user at login before onboarding). Anything else is a
        // real generation failure worth a stack. Either way the player is never
        // blocked: the synchronous `/daily` POST regenerates on demand.
        const isFillError = error instanceof orchestrator.DailyQueueFillError;
        const outcome = isFillError ? error.code : 'error';
        logLatency('daily_queue_prewarm', Date.now() - startedAt, { trigger, outcome });
        if (!isFillError) {
          console.error('[daily/prewarm] failed', {
            userId,
            trigger,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
  } catch {
    // `after()` requires an active request context. If it's unavailable (a
    // non-request caller, or a test harness invoking the route handler
    // directly), skip the pre-warm rather than failing the caller — the
    // synchronous `/daily` POST is always there as the fallback.
    console.warn('[daily/prewarm] could not schedule pre-warm', { userId, trigger });
  }
}
