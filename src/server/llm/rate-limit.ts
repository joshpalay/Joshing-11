/**
 * B-LLM-RATE-LIMIT-01 — shared per-user daily cap for on-demand LLM endpoints
 * (answer suggestion, verify-answer, crafter drafting, question creation,
 * critique, ...). Backed by LlmUsageDaily (one row per user/day/action).
 *
 * Call getDailyLlmUsageCount BEFORE the LLM call to short-circuit over-quota
 * requests without spending tokens, then incrementDailyLlmUsage AFTER a
 * successful call. Both fail open on any DB error — a rate-limit outage must
 * never block the underlying feature (same posture as the critique route's
 * existing fail_open catch).
 */
import { and, eq, sql } from 'drizzle-orm';

import { db, llmUsageDaily } from '@/server/db';

export function utcDateString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function getDailyLlmUsageCount(
  userId: string,
  action: string,
  usageDate: string = utcDateString(),
): Promise<number> {
  try {
    const [usage] = await db
      .select({ count: llmUsageDaily.count })
      .from(llmUsageDaily)
      .where(
        and(
          eq(llmUsageDaily.userId, userId),
          eq(llmUsageDaily.usageDate, usageDate),
          eq(llmUsageDaily.action, action),
        ),
      )
      .limit(1);
    return usage?.count ?? 0;
  } catch (error) {
    console.warn('[rate-limit] getDailyLlmUsageCount fail_open', action, error);
    return 0;
  }
}

/**
 * Atomically adds `amount` to today's counter for (userId, action), but only
 * if the result stays within `limit` — mirrors the critique route's
 * INSERT ... ON CONFLICT DO UPDATE ... WHERE guard, generalized to a
 * variable increment (crafter drafting consumes one unit per candidate
 * requested, not one per call).
 */
export async function incrementDailyLlmUsage(
  userId: string,
  action: string,
  limit: number,
  amount = 1,
): Promise<{ ok: boolean; count: number }> {
  const usageDate = utcDateString();
  try {
    const rows = await db.execute<{ count: number }>(sql`
      INSERT INTO "LlmUsageDaily" ("user_id", "usage_date", "action", "count", "updated_at")
      VALUES (${userId}, ${usageDate}::date, ${action}, ${amount}, now())
      ON CONFLICT ("user_id", "usage_date", "action") DO UPDATE
      SET "count" = "LlmUsageDaily"."count" + ${amount},
          "updated_at" = now()
      WHERE "LlmUsageDaily"."count" + ${amount} <= ${limit}
      RETURNING "count"
    `);
    const incremented = Array.isArray(rows) ? rows[0] : rows.rows?.[0];
    if (!incremented) {
      const current = await getDailyLlmUsageCount(userId, action, usageDate);
      return { ok: false, count: current };
    }
    return { ok: true, count: Number(incremented.count) };
  } catch (error) {
    console.warn('[rate-limit] incrementDailyLlmUsage fail_open', action, error);
    return { ok: true, count: 0 };
  }
}
