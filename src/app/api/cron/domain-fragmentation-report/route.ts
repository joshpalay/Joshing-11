import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';
import { getDomainFragmentationCandidates } from '@/server/db/queries/domain-fragmentation';
import { resolveCostReportRecipient } from '@/server/db/queries/llm-cost-report';
import { sendEmail } from '@/server/email/client';
import { buildDomainFragmentationEmailTemplate } from '@/server/email/templates/domain-fragmentation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// D-NARROW-KB-FABRICATION-01 Tier-2 surfacing: a weekly digest of near-duplicate
// domain clusters that the automated reconcile deliberately left for a human to
// judge (merge vs keep). Read-and-report only — it never mutates a label. We
// email ONLY when there is something to look at (no weekly "all clear" noise);
// the cron still returns 200 with the candidate count either way. Owner can also
// trigger it manually (same cron auth) to refresh on demand.
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const pairs = await getDomainFragmentationCandidates();

    if (pairs.length === 0) {
      console.info('[domain-fragmentation-report] no candidates above threshold; skipping email');
      return NextResponse.json({ candidates: 0, emailed: false, reason: 'no_candidates' });
    }

    const recipient = await resolveCostReportRecipient();
    if (!recipient) {
      console.warn('[domain-fragmentation-report] candidates found but no recipient resolved', {
        candidates: pairs.length,
      });
      return NextResponse.json({ candidates: pairs.length, emailed: false, reason: 'no_recipient' });
    }

    const template = buildDomainFragmentationEmailTemplate(pairs);
    const sent = await sendEmail({
      to: recipient.to,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });

    if (!sent.ok) {
      console.warn('[domain-fragmentation-report] candidates found but email send failed', {
        candidates: pairs.length,
        message: sent.message,
      });
      return NextResponse.json({ candidates: pairs.length, emailed: false, reason: sent.reason });
    }

    return NextResponse.json({
      candidates: pairs.length,
      emailed: true,
      emailSource: recipient.source,
    });
  } catch (error) {
    console.error('[domain-fragmentation-report] failed', error);
    return NextResponse.json({ emailed: false, error: 'report_failed' }, { status: 500 });
  }
}
