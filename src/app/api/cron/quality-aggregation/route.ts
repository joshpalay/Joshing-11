import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';
import {
  buildQualityAggregation,
  renderQualityAggregationMarkdown,
  writeQualityReport,
} from '@/server/quality/quality-aggregation';

export const dynamic = 'force-dynamic';

// B-QUESTION-QUALITY-AGENTS-01 Phase 4 — the weekly quality digest writer.
// Scheduled Mondays (vercel.json) over a trailing 30 days. Read-and-report only:
// it rolls up vet rejections, critique counts, and the Phase-3 verification
// verdicts by broadCategory × canonicalSubcategory, enforces the per-cluster
// sample floor, stores the rendered markdown, and returns a summary. No LLM on
// this path (the proposer that consumes these clusters is Phase 5). Owner can
// trigger it manually (same cron auth) to refresh the snapshot.
const WINDOW_DAYS = 30;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const report = await buildQualityAggregation(WINDOW_DAYS);
    const markdown = renderQualityAggregationMarkdown(report);
    await writeQualityReport(report, markdown);

    return NextResponse.json({
      stored: true,
      windowDays: report.windowDays,
      floor: report.floor,
      eligible: report.eligible.length,
      belowFloor: report.belowFloor.length,
    });
  } catch (error) {
    console.error('[quality-aggregation] failed to build/store digest', error);
    return NextResponse.json({ stored: false, error: 'report_failed' }, { status: 500 });
  }
}
