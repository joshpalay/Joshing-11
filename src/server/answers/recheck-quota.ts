/**
 * B-13.5 — a recheck is a second LLM call per dispute, so an uncapped "just tap
 * it and see" pattern would get predictable. Capped per PLAYER per day (not per
 * question) so someone who catches several genuine defects in one session isn't
 * blocked. Reuses the shared LlmUsageDaily counter (src/server/llm/rate-limit.ts)
 * under its own action name so it doesn't share quota with other on-demand LLM
 * features (answer suggestion, critique, etc).
 */
import { getDailyLlmUsageCount, incrementDailyLlmUsage } from '@/server/llm/rate-limit';

export const RECHECK_DAILY_LIMIT = 3;
const RECHECK_ACTION = 'recheck';

/** Read-only check before spending tokens on the LLM call. */
export async function getRecheckQuotaRemaining(userId: string): Promise<number> {
  const count = await getDailyLlmUsageCount(userId, RECHECK_ACTION);
  return Math.max(0, RECHECK_DAILY_LIMIT - count);
}

/** Call after a completed recheck LLM call to record the spend. */
export async function consumeRecheckQuota(userId: string): Promise<{ ok: boolean; remaining: number }> {
  const { ok, count } = await incrementDailyLlmUsage(userId, RECHECK_ACTION, RECHECK_DAILY_LIMIT);
  return { ok, remaining: Math.max(0, RECHECK_DAILY_LIMIT - count) };
}
