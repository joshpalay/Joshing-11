/**
 * Read/write layer for CronBatchRun (0155) — Batch-API tracking for the
 * vet-questions and backfill-supply crons. Mirrors queries/verify-batch.ts.
 */
import { and, asc, desc, eq } from 'drizzle-orm';

import { cronBatchRun, db } from '@/server/db';

export type CronBatchKind = 'vet' | 'backfill';

export type CronBatchRunRow = {
  id: string;
  providerBatchId: string;
  requestCount: number;
  payload: Record<string, unknown>;
  createdAt: Date;
};

/** Throws on failure — a submitted batch we cannot track is spend we can never harvest. */
export async function recordCronBatchRun(
  kind: CronBatchKind,
  providerBatchId: string,
  requestCount: number,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(cronBatchRun).values({ kind, providerBatchId, requestCount, payload });
}

/** Runs of `kind` awaiting harvest, oldest first. */
export async function listSubmittedCronBatchRuns(kind: CronBatchKind): Promise<CronBatchRunRow[]> {
  return db
    .select({
      id: cronBatchRun.id,
      providerBatchId: cronBatchRun.providerBatchId,
      requestCount: cronBatchRun.requestCount,
      payload: cronBatchRun.payload,
      createdAt: cronBatchRun.createdAt,
    })
    .from(cronBatchRun)
    .where(and(eq(cronBatchRun.kind, kind), eq(cronBatchRun.status, 'submitted')))
    .orderBy(asc(cronBatchRun.createdAt));
}

/** When the most recent run of `kind` was submitted (any status), or null. */
export async function latestCronBatchSubmittedAt(kind: CronBatchKind): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: cronBatchRun.createdAt })
    .from(cronBatchRun)
    .where(eq(cronBatchRun.kind, kind))
    .orderBy(desc(cronBatchRun.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

export async function markCronBatchRun(id: string, status: 'harvested' | 'failed', now: Date): Promise<void> {
  await db.update(cronBatchRun).set({ status, harvestedAt: now }).where(eq(cronBatchRun.id, id));
}
