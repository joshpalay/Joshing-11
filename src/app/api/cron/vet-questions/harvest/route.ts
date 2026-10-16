import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';
import { isVetBatchEnabled, runVetBatchSweep } from '@/server/llm/vet-batch';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Harvest-only pass for the vet-questions Batch-API mode, scheduled ~1.5h after
 * the main sweep so this morning's batch is applied the same morning instead of
 * tomorrow. Never submits and never makes a live LLM call; a no-op while
 * VET_QUESTIONS_BATCH_ENABLED is off.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isVetBatchEnabled()) {
    return NextResponse.json({ mode: 'sync', skipped: 'batch mode off' });
  }
  const report = await runVetBatchSweep(new Date(), { submit: false });
  return NextResponse.json(report, { status: report.error ? 503 : 200 });
}
