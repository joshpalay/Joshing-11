import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';
import { runSupplyBackfill } from '@/server/daily/supply-backfill';
import { isFlagOn } from '@/server/llm/cron-batch';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Harvest-only pass for the backfill-supply Batch-API mode, ~1.5h after the
 * main run: gates, persists and embeds the batch that run submitted. Never
 * submits; a no-op unless both SUPPLY_BACKFILL_ENABLED and
 * SUPPLY_BACKFILL_BATCH_ENABLED are on.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isFlagOn('SUPPLY_BACKFILL_ENABLED') || !isFlagOn('SUPPLY_BACKFILL_BATCH_ENABLED')) {
    return NextResponse.json({ skipped: 'backfill or batch mode off' });
  }
  const report = await runSupplyBackfill({
    dryRun: false,
    limit: 0,
    systemUserId: process.env.RETRIEVAL_SYSTEM_USER_ID?.trim() || null,
    batch: true,
    batchSubmit: false,
  });
  console.info('[cron/backfill-supply/harvest] pass complete', { built: report.built, batch: report.batch ?? null });
  return NextResponse.json({ built: report.built, batch: report.batch ?? null });
}
