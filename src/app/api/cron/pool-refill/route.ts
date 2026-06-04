import { NextRequest, NextResponse } from 'next/server';

import { runPoolRefill } from '@/server/daily/retrieval-grounded';

export const dynamic = 'force-dynamic';
// B3 retrieval-grounded pool refill (PRD-D-5 §5.3). Heavy, off the user's
// critical path: it deepens the shared durable bank for thin-but-active domains
// so per-user builds keep serving from the pool. Spend is hard-capped per run by
// RETRIEVAL_DAILY_USD_CEILING; demand is derived (thin + active domains), so most
// runs spend far less. Give it the plan maximum since a run may issue many
// retrieval calls.
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.VERCEL_CRON_SECRET;
  if (!secret) return true;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ?dryRun=1 (or ?dry_run / ?preview) derives demand and PROJECTS worst-case
  // search spend without issuing any searches or persisting anything — for
  // sanity-checking which domains would be refilled and the cost before turning
  // the feature on. Projected usdSpent/webSearches cover search cost only; actual
  // runs also incur token deltas.
  const params = request.nextUrl.searchParams;
  const dryRun = ['dryRun', 'dry_run', 'preview'].some((key) => {
    const value = params.get(key);
    return value !== null && value !== 'false' && value !== '0';
  });

  const report = await runPoolRefill({ dryRun });

  // The report IS the "what's happening" deliverable: structured log line +
  // returned JSON. Spend vs. ceiling and backlogRemaining are the two numbers to
  // watch — a persistent backlog means the ceiling is below demand.
  console.info('[cron/pool-refill] run complete', {
    enabled: report.enabled,
    dryRun: report.dryRun,
    reason: report.reason,
    usdSpent: Number(report.usdSpent.toFixed(4)),
    usdCeiling: report.usdCeiling,
    webSearches: report.webSearches,
    domainsConsidered: report.domainsConsidered,
    domainsProcessed: report.domainsProcessed,
    questionsPersisted: report.questionsPersisted,
    dropped: report.dropped,
    backlogRemaining: report.backlogRemaining,
  });

  return NextResponse.json(report);
}
