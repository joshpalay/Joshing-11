/**
 * Best-effort email for the weekly prompt-improvement report
 * (D-QUESTION-QUALITY-AGENTS-01, mirrors send-cost-report.ts pattern).
 * Never throws — returns a discriminated result; a send failure must not fail
 * the route or prevent the digest from being surfaced in the JSON response.
 */
import { resolveCostReportRecipient } from '@/server/db/queries/llm-cost-report';
import { sendEmail } from './client';

export type SendPromptReportEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: 'no_recipient' | 'send_failed'; message: string };

export async function sendPromptImprovementReportEmail(
  markdown: string,
  generatedAt: Date,
): Promise<SendPromptReportEmailResult> {
  const recipient = await resolveCostReportRecipient();
  if (!recipient) {
    return {
      ok: false,
      reason: 'no_recipient',
      message: 'no LLM_COST_REPORT_EMAIL override and no admin account email on file',
    };
  }

  const dateStr = generatedAt.toISOString().slice(0, 10);
  const sendResult = await sendEmail({
    to: recipient.to,
    subject: `[Joshing] Weekly prompt-improvement report (${dateStr})`,
    html: `<pre style="font-family:monospace;white-space:pre-wrap">${markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`,
    text: markdown,
  });

  if (!sendResult.ok) {
    return { ok: false, reason: 'send_failed', message: sendResult.message };
  }
  return { ok: true, id: sendResult.id };
}
