/**
 * Best-effort delivery of the daily mastery-v2 calibration digest. Never throws —
 * mirrors send-cost-report.ts. The cron decides WHETHER to send (quiet-by-default);
 * this module handles recipient resolution + template + Resend.
 *
 * Recipient: MASTERY_CALIBRATION_REPORT_EMAIL overrides; otherwise it falls back
 * to the same admin address the cost report uses (resolveCostReportRecipient).
 */

import { sendEmail } from '@/server/email/client';
import { buildMasteryCalibrationEmailTemplate } from '@/server/email/templates/mastery-calibration';
import { resolveCostReportRecipient } from '@/server/db/queries/llm-cost-report';
import type { MasteryCalibrationMetrics } from '@/server/knowledge/mastery-calibration';

export type RecipientSource = 'env' | 'admin_verified' | 'admin_unverified';

export type SendCalibResult =
  | { ok: true; id: string | null; source: RecipientSource }
  | { ok: false; reason: 'no_recipient' | 'send_failed'; message?: string };

async function resolveRecipient(): Promise<{ to: string; source: RecipientSource } | null> {
  const override = process.env.MASTERY_CALIBRATION_REPORT_EMAIL?.trim();
  if (override) return { to: override, source: 'env' };
  const fallback = await resolveCostReportRecipient();
  return fallback ? { to: fallback.to, source: fallback.source } : null;
}

export async function sendMasteryCalibrationEmail(
  metrics: MasteryCalibrationMetrics,
  markdown: string,
): Promise<SendCalibResult> {
  const recipient = await resolveRecipient();
  if (!recipient) return { ok: false, reason: 'no_recipient' };

  const { subject, html, text } = buildMasteryCalibrationEmailTemplate({ metrics, markdown });
  const result = await sendEmail({ to: recipient.to, subject, html, text });
  if (!result.ok) return { ok: false, reason: 'send_failed', message: result.message };
  return { ok: true, id: result.id, source: recipient.source };
}
