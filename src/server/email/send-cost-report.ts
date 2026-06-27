import type { CostLatencyReport } from '@/server/db/queries/llm-cost-report';

import { sendEmail } from './client';
import { buildCostReportEmailTemplate } from './templates/llm-cost-report';

/**
 * Email the weekly LLM cost & latency digest to the operator
 * (B-LLM-COST-LATENCY-REPORT-01, Decision B3 — store AND email). Reuses the
 * existing Resend client; no new email dependency.
 *
 * Recipient is LLM_COST_REPORT_EMAIL (optional). Unset ⇒ this is a no-op
 * ('not_configured'), so the cron still stores its digest and never fails just
 * because email isn't wired up. Never throws — returns a discriminated result
 * the caller folds into its response, exactly like sendVerificationEmail.
 */
export type SendCostReportEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: 'not_configured' | 'send_failed'; message: string };

export async function sendCostReportEmail(
  report: CostLatencyReport,
  markdown: string,
): Promise<SendCostReportEmailResult> {
  const to = process.env.LLM_COST_REPORT_EMAIL?.trim();
  if (!to) {
    return { ok: false, reason: 'not_configured', message: 'LLM_COST_REPORT_EMAIL not set' };
  }

  const template = buildCostReportEmailTemplate({ report, markdown });
  const sendResult = await sendEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });

  if (!sendResult.ok) {
    return { ok: false, reason: 'send_failed', message: sendResult.message };
  }
  return { ok: true, id: sendResult.id };
}
