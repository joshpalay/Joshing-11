import { NextRequest, NextResponse } from 'next/server';

import { runSupplyBackfill } from '@/server/daily/supply-backfill';
import { isCronAuthorized } from '@/server/auth/cron';

export const dynamic = 'force-dynamic';
// A run generates for a few domains (each a Sonnet batch + Haiku/Sonnet gates,
// plus one cached web search for fandom domains). Capped per run so it completes
// inside the plan maximum; the nightly cadence + low-water plan converge the
// bank over many nights rather than one long run.
export const maxDuration = 300;

// Inventory-build cron (companion to the JIT per-user path). Pre-builds a
// demand-weighted buffer per demanded, under-stocked domain so per-user daily
// builds increasingly serve from the bank. OFF by default: enable with
// SUPPLY_BACKFILL_ENABLED and set RETRIEVAL_SYSTEM_USER_ID (the owning user for
// pool rows) — without it the run generates nothing that persists.
function isEnabled(): boolean {
  const raw = process.env.SUPPLY_BACKFILL_ENABLED?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

// Neediest-first domains built per run. Small so a run finishes inside
// maxDuration; the schedule converges the rest over subsequent nights.
const MAX_DOMAINS_PER_RUN = Math.max(1, Number(process.env.SUPPLY_BACKFILL_MAX_DOMAINS_PER_RUN ?? 3));

// Nightly spend ceiling (2026-08-07, Josh: "slower so it takes longer but is
// cheaper per day"). The cron runs once a night, so a per-run cap IS the daily
// cap: the bank converges over more nights at a cost you choose up front rather
// than in one burst when the flag flips. Applied to the plan's own cost
// estimate (estimateBatchCost), so it stays honest as model prices move —
// which matters with the Sonnet 5 intro pricing ending 2026-08-31.
// Set 0 (or a negative) to disable and let MAX_DOMAINS_PER_RUN alone govern.
const DAILY_BUDGET_USD = (() => {
  const raw = process.env.SUPPLY_BACKFILL_DAILY_BUDGET_USD?.trim();
  const parsed = raw === undefined || raw === '' ? 0.5 : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
})();

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ?dryRun=1 (or ?dry_run / ?preview) computes the plan + cost without any
  // generation or persistence — for sanity-checking before enabling.
  const params = request.nextUrl.searchParams;
  const dryRun =
    !isEnabled() ||
    ['dryRun', 'dry_run', 'preview'].some((key) => {
      const value = params.get(key);
      return value !== null && value !== 'false' && value !== '0';
    });

  const systemUserId = process.env.RETRIEVAL_SYSTEM_USER_ID?.trim() || null;

  const report = await runSupplyBackfill({
    dryRun,
    limit: MAX_DOMAINS_PER_RUN,
    systemUserId,
    budgetUsd: DAILY_BUDGET_USD,
  });

  console.info('[cron/backfill-supply] run complete', {
    enabled: isEnabled(),
    dryRun: report.dryRun,
    systemUser: report.systemUser,
    actionableDomains: report.actionableDomains,
    totalQuestionsPlanned: report.totalQuestionsPlanned,
    estCostUsd: report.estCostUsd,
    // Pacing telemetry: selectedCostUsd is what tonight should actually cost,
    // deferredForBudget how many needy domains are waiting on a later night.
    // A deferredForBudget that never reaches 0 means the budget is below the
    // domains' arrival rate — raise it or accept a permanently slower fill.
    budgetUsd: report.budgetUsd,
    selectedCostUsd: report.selectedCostUsd,
    deferredForBudget: report.deferredForBudget,
    built: report.built,
  });

  return NextResponse.json(report);
}
