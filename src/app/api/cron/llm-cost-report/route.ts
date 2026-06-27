import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';
import {
  buildCostLatencyReport,
  renderCostLatencyReportMarkdown,
  writeCostReport,
} from '@/server/db/queries/llm-cost-report';

export const dynamic = 'force-dynamic';

// B-LLM-COST-LATENCY-REPORT-01 — the weekly digest writer (Decision B1/C1).
// Scheduled Mondays (vercel.json) over the trailing 7 days, with a week-over-week
// delta and a trailing-30-day total baked into the report. Read-and-report only:
// it reads LlmUsageEvent rows recordLlmUsage already wrote and stores the rendered
// markdown. Owner can also trigger it manually (same cron auth) to refresh the
// stored snapshot on demand.
const WINDOW_DAYS = 7;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const report = await buildCostLatencyReport(WINDOW_DAYS);
    const markdown = renderCostLatencyReportMarkdown(report);
    await writeCostReport(report, markdown);
    return NextResponse.json({
      stored: true,
      windowDays: report.windowDays,
      totalUsd: Number(report.totalUsd.toFixed(4)),
      surfaces: report.surfaces.length,
      anyUnpriced: report.anyUnpriced,
    });
  } catch (error) {
    console.error('[llm-cost-report] failed to build/store digest', error);
    return NextResponse.json({ stored: false, error: 'report_failed' }, { status: 500 });
  }
}
