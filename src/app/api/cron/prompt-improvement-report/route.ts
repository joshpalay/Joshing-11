/**
 * Weekly prompt-improvement report (D-QUESTION-QUALITY-AGENTS-01, Decisions C/D/S5).
 *
 * Scheduled Mondays (vercel.json), one hour after the llm-cost-report so the
 * weekly LLM cost window is already closed. Runs in two stages:
 *
 *   1. Aggregation — rolls up publicStatus='rejected' and
 *      verificationVerdict='demoted' questions by category × subcategory over
 *      the trailing 30 days. Clusters below the minimum sample-size floor
 *      (Decision C default: 5) are dropped to avoid over-fitting.
 *
 *   2. Prompt-diff proposal — Sonnet reads the live GENERATION_SYSTEM_PROMPT
 *      fresh and proposes a targeted diff based on the failure evidence.
 *      The output is a proposal only; there is NO write path to any prompt
 *      file (Decision S5). The "DO NOT AUTO-APPLY" header is enforced both in
 *      the LLM instructions and as a post-processing banner on the output.
 *
 * Best-effort email (mirrors llm-cost-report pattern): a send failure does not
 * fail the route. The proposal is always returned in the JSON response so it is
 * accessible without email being configured.
 */
import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';
import {
  buildRejectionAggregation,
  renderRejectionAggregationMarkdown,
} from '@/server/db/queries/rejection-aggregation';
import { sendPromptImprovementReportEmail } from '@/server/email/send-prompt-improvement-report';
import {
  proposeGenerationPromptDiff,
  renderPromptImprovementReport,
} from '@/server/llm/prompt-improvement';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;
const MIN_SAMPLE_SIZE = 5;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // Stage 1: aggregation (pure DB read, no LLM)
    const aggregation = await buildRejectionAggregation(WINDOW_DAYS, MIN_SAMPLE_SIZE);
    const aggregationMarkdown = renderRejectionAggregationMarkdown(aggregation);

    // Stage 2: prompt-diff proposal (Sonnet, reads live prompt)
    const proposal = await proposeGenerationPromptDiff(aggregation);

    const reportMarkdown = renderPromptImprovementReport({
      aggregation,
      aggregationMarkdown,
      proposal,
    });

    // Best-effort email — a send failure must not fail the stored/returned report
    const email = await sendPromptImprovementReportEmail(
      reportMarkdown,
      aggregation.generatedAt,
    );
    if (!email.ok && email.reason === 'send_failed') {
      console.warn('[prompt-improvement-report] proposal generated but email send failed', {
        message: email.message,
      });
    }

    return NextResponse.json({
      windowDays: aggregation.windowDays,
      minSampleSize: aggregation.minSampleSize,
      totalRejected: aggregation.totalRejected,
      totalDemoted: aggregation.totalDemoted,
      clusters: aggregation.clusters.length,
      proposalOk: proposal.ok,
      proposalReason: proposal.ok ? undefined : proposal.reason,
      emailed: email.ok,
      emailReason: email.ok ? undefined : email.reason,
      // Include the full markdown so it is accessible without email
      markdown: reportMarkdown,
    });
  } catch (error) {
    console.error('[prompt-improvement-report] failed', error);
    return NextResponse.json({ error: 'report_failed' }, { status: 500 });
  }
}
