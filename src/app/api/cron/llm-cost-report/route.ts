import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';
import {
  buildCostLatencyReport,
  renderCostLatencyReportMarkdown,
  writeCostReport,
} from '@/server/db/queries/llm-cost-report';
import { sendCostReportEmail } from '@/server/email/send-cost-report';
import { buildSupplyCoverageSummary } from '@/server/daily/supply-coverage';

export const dynamic = 'force-dynamic';

// B-LLM-COST-LATENCY-REPORT-01 — the weekly digest writer (Decisions B3/C1).
// Scheduled Mondays (vercel.json) over the trailing 7 days, with a week-over-week
// delta and a trailing-30-day total baked into the report. Read-and-report only:
// it reads LlmUsageEvent rows recordLlmUsage already wrote, stores the rendered
// markdown, then emails it to LLM_COST_REPORT_EMAIL if configured. Owner can also
// trigger it manually (same cron auth) to refresh the snapshot / resend on demand.
const WINDOW_DAYS = 7;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const report = await buildCostLatencyReport(WINDOW_DAYS);
    const markdown = renderCostLatencyReportMarkdown(report);
    await writeCostReport(report, markdown);

    // Domain-supply coverage section (D-SUPPLY-FINITENESS-01 #5): discrepancy
    // domains (dry far short of a trusted corpus estimate) surface here weekly.
    // buildSupplyCoverageSummary fails open (null → section simply absent), so
    // it can never block the cost digest.
    const supply = await buildSupplyCoverageSummary();

    // Best-effort email (Decision B3) — a send failure must not fail the stored
    // digest, which is the durable artifact. sendCostReportEmail never throws.
    const email = await sendCostReportEmail(report, markdown, supply);
    if (!email.ok && email.reason === 'send_failed') {
      console.warn('[llm-cost-report] digest stored but email send failed', { message: email.message });
    }

    return NextResponse.json({
      stored: true,
      windowDays: report.windowDays,
      totalUsd: Number(report.totalUsd.toFixed(4)),
      surfaces: report.surfaces.length,
      anyUnpriced: report.anyUnpriced,
      supplyDiscrepancies: supply ? supply.discrepancies.length : null,
      supplyDomains: supply ? supply.entries.length : null,
      emailed: email.ok,
      emailSource: email.ok ? email.source : undefined,
      emailReason: email.ok ? undefined : email.reason,
    });
  } catch (error) {
    console.error('[llm-cost-report] failed to build/store digest', error);
    return NextResponse.json({ stored: false, error: 'report_failed' }, { status: 500 });
  }
}
