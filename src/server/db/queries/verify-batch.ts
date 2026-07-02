/**
 * Read/write layer for VerifyBatchRun (0106) — the batch-verify cron's async-mode
 * tracking table. One row per submitted Anthropic Message Batch; the daily cron
 * harvests 'submitted' runs before submitting a new one. Small, removable as a
 * unit with BATCH_VERIFY_ASYNC_ENABLED.
 */
import { asc, eq } from 'drizzle-orm';

import { db, verifyBatchRun } from '@/server/db';

export type VerifyBatchRunRow = {
  id: string;
  providerBatchId: string;
  requestCount: number;
  createdAt: Date;
};

/** Record a freshly submitted batch. Throws on failure — a batch we submitted but
 *  cannot track would be re-billable work lost, so the caller must see it. */
export async function recordVerifyBatchRun(
  providerBatchId: string,
  requestCount: number,
): Promise<void> {
  await db.insert(verifyBatchRun).values({ providerBatchId, requestCount });
}

/** All runs awaiting harvest, oldest first. */
export async function listSubmittedVerifyBatchRuns(): Promise<VerifyBatchRunRow[]> {
  const rows = await db
    .select({
      id: verifyBatchRun.id,
      providerBatchId: verifyBatchRun.providerBatchId,
      requestCount: verifyBatchRun.requestCount,
      createdAt: verifyBatchRun.createdAt,
    })
    .from(verifyBatchRun)
    .where(eq(verifyBatchRun.status, 'submitted'))
    .orderBy(asc(verifyBatchRun.createdAt));
  return rows;
}

export async function markVerifyBatchRunHarvested(id: string, now: Date): Promise<void> {
  await db
    .update(verifyBatchRun)
    .set({ status: 'harvested', harvestedAt: now })
    .where(eq(verifyBatchRun.id, id));
}

/** Terminal give-up (stale/expired batch). The rows it covered are still
 *  unstamped, so the next submission simply re-picks them. */
export async function markVerifyBatchRunFailed(id: string, now: Date): Promise<void> {
  await db
    .update(verifyBatchRun)
    .set({ status: 'failed', harvestedAt: now })
    .where(eq(verifyBatchRun.id, id));
}
