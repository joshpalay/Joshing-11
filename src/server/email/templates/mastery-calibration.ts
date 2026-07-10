/**
 * Email template for the daily mastery-v2 calibration digest.
 *
 * Internal admin digest — a branded header + the rendered markdown body (kept as
 * the email `text` so the stored snapshot and the email stay byte-identical). The
 * HTML is a lightweight card, not a per-metric table, so there's nothing to drift
 * out of sync with the markdown renderer.
 */

import type { MasteryCalibrationMetrics } from '@/server/knowledge/mastery-calibration';

const CREAM = '#fcf8f2';
const CARD = '#fdfcfb';
const INK = '#0a1f3d';
const MUTED = '#5b6472';
const DANGER = '#a3341f';
const OK = '#1f6d3a';
const SANS =
  "'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildMasteryCalibrationEmailTemplate(params: {
  metrics: MasteryCalibrationMetrics;
  markdown: string;
}): { subject: string; html: string; text: string } {
  const { metrics, markdown } = params;
  const notReady = metrics.verdict === 'NOT_READY';

  const subject = notReady
    ? `Mastery-v2 calibration — NOT READY (${metrics.badges.lostByRealPlayers} badge${metrics.badges.lostByRealPlayers === 1 ? '' : 's'} at risk)`
    : `Mastery-v2 calibration — READY (${metrics.reachability.bucket75plus} mastered pairs)`;

  const verdictColor = notReady ? DANGER : OK;
  const shadowNote = metrics.shadow
    ? 'Shadow mode — computed without enabling the v2 flag.'
    : 'v2 flag is LIVE.';

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:${CREAM};font-family:${SANS};color:${INK}">
  <div style="max-width:680px;margin:0 auto;background:${CARD};border-radius:12px;padding:28px 32px;border:1px solid #eadfce">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED}">Mastery v2 · daily calibration</div>
    <div style="font-size:22px;font-weight:700;margin:6px 0 2px">Flip-readiness: <span style="color:${verdictColor}">${esc(metrics.verdict)}</span></div>
    <div style="font-size:12px;color:${MUTED};margin-bottom:16px">${esc(shadowNote)}</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
      <div><div style="font-size:11px;color:${MUTED}">BADGES LOST ON FLIP</div><div style="font-size:20px;font-weight:700;color:${metrics.badges.lostByRealPlayers > 0 ? DANGER : INK}">${metrics.badges.lostByRealPlayers}</div></div>
      <div><div style="font-size:11px;color:${MUTED}">UNMASTERABLE (THRESHOLD)</div><div style="font-size:20px;font-weight:700">${metrics.classificationCounts.UNREACHABLE_THRESHOLD}</div></div>
      <div><div style="font-size:11px;color:${MUTED}">MASTERED PAIRS</div><div style="font-size:20px;font-weight:700">${metrics.reachability.bucket75plus}</div></div>
      <div><div style="font-size:11px;color:${MUTED}">v1 → v2 BADGES</div><div style="font-size:20px;font-weight:700">${metrics.badges.v1Total} → ${metrics.badges.v2Total}</div></div>
    </div>
    <pre style="white-space:pre-wrap;font-family:${MONO};font-size:12px;line-height:1.5;background:${CREAM};padding:16px;border-radius:8px;overflow-x:auto">${esc(markdown)}</pre>
  </div>
</body></html>`;

  return { subject, html, text: markdown };
}
