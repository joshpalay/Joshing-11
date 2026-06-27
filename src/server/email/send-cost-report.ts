import {
  resolveCostReportRecipient,
  type CostLatencyReport,
  type CostReportRecipient,
} from '@/server/db/queries/llm-cost-report';

import { sendEmail } from './client';
import { buildCostReportEmailTemplate } from './templates/llm-cost-report';

/**
 * Email the weekly LLM cost & latency digest to the operator
 * (B-LLM-COST-LATENCY-REPORT-01, Decision B3 — store AND email). Reuses the
 * existing Resend client; no new email dependency.
 *
 * Recipient comes from resolveCostReportRecipient: the LLM_COST_REPORT_EMAIL
 * override if set, else the admin account's email. No recipient resolves ⇒ this
 * is a no-op ('no_recipient'), so the cron still stores its digest and never
 * fails just because email isn't wired up. Never throws — returns a discriminated
 * result the caller folds into its response, like sendVerificationEmail.
 */
export type SendCostReportEmailResult =
  | { ok: true; id: string | null; source: CostReportRecipient['source'] }
  | { ok: false; reason: 'no_recipient' | 'send_failed'; message: string };

export async function sendCostReportEmail(
  report: CostLatencyReport,
  markdown: string,
): Promise<SendCostReportEmailResult> {
  const recipient = await resolveCostReportRecipient();
  if (!recipient) {
    return {
      ok: false,
      reason: 'no_recipient',
      message: 'no LLM_COST_REPORT_EMAIL override and no admin account email on file',
    };
  }

  const template = buildCostReportEmailTemplate({ report, markdown });
  const sendResult = await sendEmail({
    to: recipient.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });

  if (!sendResult.ok) {
    return { ok: false, reason: 'send_failed', message: sendResult.message };
  }
  return { ok: true, id: sendResult.id, source: recipient.source };
}
