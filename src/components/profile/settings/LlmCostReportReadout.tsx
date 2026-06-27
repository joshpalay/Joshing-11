/**
 * Owner-only readout for the weekly LLM cost & latency digest
 * (B-LLM-COST-LATENCY-REPORT-01). Same shape as LlmExperimentReadout: an async
 * loader (loadCostReportData) the awaited page runs, plus a SYNC presentational
 * component so renderToStaticMarkup / the page test can render it without RSC
 * async support.
 *
 * Renders the report LIVE over the trailing 7 days (always fresh, independent of
 * whether the Monday cron has run yet) and links it to the cron's durable
 * snapshot by showing when that last stored digest was written. Shown only for
 * the owner — the page gates it on ADMIN_USER_IDS, so it does no auth of its own.
 */
import {
  buildCostLatencyReport,
  readLatestCostReport,
  type CostLatencyReport,
} from '@/server/db/queries/llm-cost-report';

const WINDOW_DAYS = 7;

function usd(n: number | null): string {
  if (n == null) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function ms(n: number | null): string {
  if (n == null) return '—';
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

function num(n: number): string {
  return n.toLocaleString('en-US');
}

function deltaPhrase(curr: number, prev: number): string {
  if (prev <= 0) return curr > 0 ? 'no comparable spend last week' : 'flat vs last week';
  const change = (curr - prev) / prev;
  if (Math.abs(change) < 0.01) return 'about flat vs last week';
  return `${change > 0 ? 'up' : 'down'} ${pct(Math.abs(change))} vs last week`;
}

export type CostReportData = {
  report: CostLatencyReport | null;
  latestStoredAt: Date | null;
};

/**
 * Build the live report and read the last stored snapshot's timestamp, tolerating
 * individual failures (a missing table degrades to a soft note rather than
 * crashing the settings page).
 */
export async function loadCostReportData(): Promise<CostReportData> {
  const [reportR, latestR] = await Promise.allSettled([
    buildCostLatencyReport(WINDOW_DAYS),
    readLatestCostReport(),
  ]);
  return {
    report: reportR.status === 'fulfilled' ? reportR.value : null,
    latestStoredAt:
      latestR.status === 'fulfilled' && latestR.value ? latestR.value.createdAt : null,
  };
}

export function LlmCostReportReadout({ data }: { data: CostReportData }) {
  const { report, latestStoredAt } = data;

  return (
    <section className="mb-8">
      <h2 className="text-muted-foreground mb-1 text-sm font-semibold tracking-wide uppercase">
        LLM Cost &amp; Latency — Weekly Digest
      </h2>
      <p className="text-muted-foreground mb-3 text-xs">
        Spend and player-facing wait time over the last {WINDOW_DAYS} days, rolled up by surface.
        Shown live here; the Monday cron stores the same digest as a snapshot.
        {latestStoredAt
          ? ` Last stored ${latestStoredAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`
          : ' No stored snapshot yet.'}
      </p>

      {report == null ? (
        <p className="text-destructive text-xs">Couldn&apos;t build the cost &amp; latency report.</p>
      ) : (
        <div className="bg-card text-card-foreground flex flex-col gap-6 rounded-xl border p-4">
          {/* ── Total + week-over-week ── */}
          <div>
            <h3 className="text-sm font-semibold">
              Total this week — {usd(report.totalUsd)}
              {report.anyUnpriced ? ' *' : ''}
            </h3>
            <p className="text-muted-foreground text-xs">
              {deltaPhrase(report.totalUsd, report.prevTotalUsd)} · {usd(report.monthUsd)} trailing 30 days
            </p>
          </div>

          {/* ── Spend by surface ── */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Where the money went</h3>
            {report.surfaces.length === 0 ? (
              <p className="text-muted-foreground text-xs">No LLM spend recorded this week.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    <th className="py-1 font-medium">Surface</th>
                    <th className="py-1 text-right font-medium">Calls</th>
                    <th className="py-1 text-right font-medium">Est. USD</th>
                    <th className="py-1 text-right font-medium">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {report.surfaces.map((s) => (
                    <tr key={s.key} className="border-t">
                      <td className="py-1">
                        {s.label}
                        {s.unpriced ? ' *' : ''}
                      </td>
                      <td className="py-1 text-right tabular-nums">{num(s.calls)}</td>
                      <td className="py-1 text-right tabular-nums">{usd(s.costUsd)}</td>
                      <td className="py-1 text-right tabular-nums">
                        {report.totalUsd > 0 ? pct(s.costUsd / report.totalUsd) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Cost per unit ── */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Cost per unit</h3>
            <ul className="text-sm">
              <li className="flex items-baseline justify-between gap-3">
                <span>Per question generated</span>
                <span className="text-muted-foreground tabular-nums">
                  {report.costPerQuestionUsd != null
                    ? `${usd(report.costPerQuestionUsd)} · ${num(report.questionsGenerated)} made`
                    : 'no questions generated'}
                </span>
              </li>
              <li className="flex items-baseline justify-between gap-3">
                <span>Per answer graded</span>
                <span className="text-muted-foreground tabular-nums">
                  {report.costPerAnswerGradedUsd != null
                    ? `${usd(report.costPerAnswerGradedUsd)} · ${num(report.answersGraded)} graded`
                    : 'no answers graded by the model'}
                </span>
              </li>
            </ul>
          </div>

          {/* ── Speed ── */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">How long players wait</h3>
            {report.slowestPlayerFacing ? (
              <p className="text-muted-foreground mb-2 text-xs">
                Players wait longest on {report.slowestPlayerFacing.label.toLowerCase()}: ~
                {ms(report.slowestPlayerFacing.avgMs)} average, ~{ms(report.slowestPlayerFacing.p95Ms)} at worst.
              </p>
            ) : (
              <p className="text-muted-foreground mb-2 text-xs">No timed player-facing calls this week.</p>
            )}
            {report.latency.some((l) => l.calls > 0) ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    <th className="py-1 font-medium">Surface</th>
                    <th className="py-1 text-right font-medium">Avg</th>
                    <th className="py-1 text-right font-medium">Worst (p95)</th>
                  </tr>
                </thead>
                <tbody>
                  {report.latency
                    .filter((l) => l.calls > 0)
                    .map((l) => (
                      <tr key={l.key} className="border-t">
                        <td className="py-1">{l.label}</td>
                        <td className="py-1 text-right tabular-nums">{ms(l.avgMs)}</td>
                        <td className="py-1 text-right tabular-nums">{ms(l.p95Ms)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : null}
          </div>

          {report.anyUnpriced ? (
            <p className="text-muted-foreground text-xs italic">
              * some calls ran on a model with no entry in the price map — the dollar figures are a floor
              (real spend is at least this much).
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
