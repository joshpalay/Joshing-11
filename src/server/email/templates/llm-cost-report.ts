import type { CostLatencyReport } from '@/server/db/queries/llm-cost-report';

/**
 * Email template for the weekly LLM cost & latency digest
 * (B-LLM-COST-LATENCY-REPORT-01, Decision B3 — store AND email). An owner-only
 * operational digest, not a player-facing send: quiet, table-led, on-brand.
 *
 * The plain-text body IS the already-rendered markdown digest (the same words
 * stored in LlmCostReport), so the text part never drifts from the stored
 * artifact. The HTML part is a light branded rendering of the same structured
 * report. No unsubscribe footer — this goes to the operator, not a list.
 */

// Brand palette — inlined from src/app/globals.css, same as daily-reminder.ts
// (mail clients can't read CSS custom properties). Keep in lockstep.
const CREAM = '#fcf8f2';
const CARD = '#fdfcfb';
const INK = '#0a1f3d';
const INK_SOFT = '#3a4a5f';
const INK_FAINT = '#8a8a8a';
const RULE = '#e9e2d2';

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

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

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function deltaPhrase(curr: number, prev: number): string {
  if (prev <= 0) return curr > 0 ? 'no comparable spend last week' : 'flat vs last week';
  const change = (curr - prev) / prev;
  if (Math.abs(change) < 0.01) return 'about flat vs last week';
  return `${change > 0 ? 'up' : 'down'} ${pct(Math.abs(change))} vs last week`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function eyebrow(label: string): string {
  return `<tr><td style="font-family:${SANS};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${INK_FAINT};padding:18px 0 10px;">${escapeHtml(label)}</td></tr>`;
}

function th(label: string, align: 'left' | 'right'): string {
  return `<th align="${align}" style="font-family:${SANS};font-size:11px;color:${INK_FAINT};font-weight:600;text-transform:uppercase;letter-spacing:0.04em;padding:0 0 6px;border-bottom:1px solid ${RULE};">${escapeHtml(label)}</th>`;
}

function td(value: string, align: 'left' | 'right'): string {
  return `<td align="${align}" style="font-family:${SERIF};font-size:15px;color:${INK};padding:6px 0;border-bottom:1px solid ${RULE};">${value}</td>`;
}

export function buildCostReportEmailTemplate(params: {
  report: CostLatencyReport;
  markdown: string;
}): { subject: string; html: string; text: string } {
  const { report: r, markdown } = params;
  const range = `${fmtDate(r.periodStart)}–${fmtDate(r.periodEnd)}`;
  const subject = `LLM cost & latency — ${usd(r.totalUsd)} this week (${range})`;

  // Spend-by-surface rows.
  const surfaceRows =
    r.surfaces.length === 0
      ? `<tr><td style="font-family:${SERIF};font-size:15px;color:${INK_SOFT};padding:6px 0;">No LLM spend recorded this week.</td></tr>`
      : r.surfaces
          .map((s) => {
            const share = r.totalUsd > 0 ? pct(s.costUsd / r.totalUsd) : '—';
            const label = escapeHtml(s.label) + (s.unpriced ? ' *' : '');
            return `<tr>${td(label, 'left')}${td(num(s.calls), 'right')}${td(usd(s.costUsd), 'right')}${td(share, 'right')}</tr>`;
          })
          .join('');

  // Latency rows (only timed surfaces).
  const timed = r.latency.filter((l) => l.calls > 0);
  const latencyRows = timed
    .map((l) => `<tr>${td(escapeHtml(l.label), 'left')}${td(ms(l.avgMs), 'right')}${td(ms(l.p95Ms), 'right')}</tr>`)
    .join('');

  const slowest = r.slowestPlayerFacing
    ? `Players wait longest on <strong>${escapeHtml(r.slowestPlayerFacing.label.toLowerCase())}</strong>: ~${ms(
        r.slowestPlayerFacing.avgMs,
      )} average, ~${ms(r.slowestPlayerFacing.p95Ms)} at worst.`
    : 'No timed player-facing calls this week.';

  const perQuestion =
    r.costPerQuestionUsd != null
      ? `${usd(r.costPerQuestionUsd)} <span style="color:${INK_FAINT};">· ${num(r.questionsGenerated)} made</span>`
      : `<span style="color:${INK_FAINT};">no questions generated</span>`;
  const perGrade =
    r.costPerAnswerGradedUsd != null
      ? `${usd(r.costPerAnswerGradedUsd)} <span style="color:${INK_FAINT};">· ${num(r.answersGraded)} graded</span>`
      : `<span style="color:${INK_FAINT};">no answers graded by the model</span>`;

  const unpricedNote = r.anyUnpriced
    ? `<tr><td style="font-family:${SANS};font-size:12px;font-style:italic;color:${INK_FAINT};padding-top:18px;">* some calls ran on a model with no price on file — the dollar figures are a floor (real spend is at least this much).</td></tr>`
    : '';

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:${CREAM};font-family:${SERIF};color:${INK};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${CREAM};padding:40px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:${CARD};border:1px solid ${RULE};border-radius:12px;">
          <tr><td style="padding:32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr><td style="font-family:${SANS};font-size:13px;letter-spacing:0.04em;color:${INK_SOFT};padding-bottom:14px;">Joshing · LLM cost & latency</td></tr>
              <tr><td style="font-family:${SERIF};font-size:28px;line-height:1.25;font-weight:700;color:${INK};padding-bottom:8px;">${usd(
                r.totalUsd,
              )} this week</td></tr>
              <tr><td style="font-family:${SERIF};font-size:16px;line-height:1.5;color:${INK_SOFT};padding-bottom:4px;">${escapeHtml(
                range,
              )} · ${escapeHtml(deltaPhrase(r.totalUsd, r.prevTotalUsd))}</td></tr>
              <tr><td style="font-family:${SERIF};font-size:14px;color:${INK_FAINT};">Trailing 30 days: ${usd(
                r.monthUsd,
              )}</td></tr>

              ${eyebrow('Where the money went')}
              <tr><td>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>${th('Surface', 'left')}${th('Calls', 'right')}${th('Est. USD', 'right')}${th('Share', 'right')}</tr>
                  ${surfaceRows}
                </table>
              </td></tr>

              ${eyebrow('Cost per unit')}
              <tr><td style="font-family:${SERIF};font-size:15px;color:${INK};padding:2px 0;">Per question generated — ${perQuestion}</td></tr>
              <tr><td style="font-family:${SERIF};font-size:15px;color:${INK};padding:2px 0;">Per answer graded — ${perGrade}</td></tr>

              ${eyebrow('How long players wait')}
              <tr><td style="font-family:${SERIF};font-size:15px;line-height:1.6;color:${INK};padding-bottom:8px;">${slowest}</td></tr>
              ${
                timed.length > 0
                  ? `<tr><td>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>${th('Surface', 'left')}${th('Avg', 'right')}${th('Worst (p95)', 'right')}</tr>
                  ${latencyRows}
                </table>
              </td></tr>`
                  : ''
              }

              ${unpricedNote}
            </table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html, text: markdown };
}
