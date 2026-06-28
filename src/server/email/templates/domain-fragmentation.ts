import type { FragmentationPair, NarrowDomain } from '@/server/db/queries/domain-fragmentation';

export type DomainFragmentationEmail = {
  subject: string;
  html: string;
  text: string;
};

export type DomainReviewInput = {
  pairs: FragmentationPair[];
  narrowDomains: NarrowDomain[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/**
 * Weekly domain-review digest with two sections:
 *   1. Merge clusters — near-duplicate labels the reconcile left for a human call.
 *   2. Breadth flags (Lever A) — broad domains leaning heavily on one facet.
 * Either section may be empty. Pure render; the cron resolves recipient + sends.
 */
export function buildDomainFragmentationEmailTemplate(
  input: DomainReviewInput,
): DomainFragmentationEmail {
  const { pairs, narrowDomains } = input;

  const subjectParts: string[] = [];
  if (pairs.length > 0) {
    subjectParts.push(`${pairs.length} merge cluster${pairs.length === 1 ? '' : 's'}`);
  }
  if (narrowDomains.length > 0) {
    subjectParts.push(`${narrowDomains.length} breadth flag${narrowDomains.length === 1 ? '' : 's'}`);
  }
  const subject =
    subjectParts.length === 0
      ? 'Domain review: nothing to look at this week'
      : `Domain review: ${subjectParts.join(' + ')}`;

  if (subjectParts.length === 0) {
    const text =
      'No near-duplicate domain clusters and no broad-but-narrow domains crossed the review threshold this week. Tier-1 prevention is holding.';
    return { subject, text, html: `<p>${escapeHtml(text)}</p>` };
  }

  // ── Section 1: merge clusters ──────────────────────────────────────────────
  const textBlocks: string[] = [];
  const htmlBlocks: string[] = [];

  if (pairs.length > 0) {
    const intro =
      'These domain pairs look similar but were not auto-merged — each is a judgment call. ' +
      'If a pair is the same scope, reply and I’ll merge them; if they’re genuinely different ' +
      '(a specific work vs its genre, two siblings), leave them.';
    const lines = pairs.map(
      (p, i) =>
        `${i + 1}. ${p.domainA} (${p.depthA}) ≈ ${p.domainB} (${p.depthB})  —  ${pct(p.similarity)} similar`,
    );
    textBlocks.push(`MERGE CLUSTERS\n${intro}\n\n${lines.join('\n')}`);

    const rows = pairs
      .map(
        (p) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(p.domainA)} <span style="color:#888;">(${p.depthA})</span></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#888;">&asymp;</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(p.domainB)} <span style="color:#888;">(${p.depthB})</span></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#555;">${pct(p.similarity)}</td>
      </tr>`,
      )
      .join('');
    htmlBlocks.push(`
      <h3 style="font-size:15px;margin:0 0 4px;">Merge clusters</h3>
      <p style="margin:0 0 8px;">${escapeHtml(intro)}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#888;font-size:12px;">
            <th style="padding:6px 10px;">Domain A (depth)</th>
            <th style="padding:6px 10px;"></th>
            <th style="padding:6px 10px;">Domain B (depth)</th>
            <th style="padding:6px 10px;text-align:right;">Similarity</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  // ── Section 2: breadth flags (Lever A) ─────────────────────────────────────
  if (narrowDomains.length > 0) {
    const intro =
      'These broad domains lean heavily on a single facet — they may be serving narrow ' +
      '(e.g. a "Shakespearean Tragedy" pool that is mostly one play). Worth checking whether ' +
      'the pool genuinely spans the domain’s range, or wants more breadth generated.';
    const lines = narrowDomains.map(
      (d, i) =>
        `${i + 1}. ${d.domain} (${d.depth} q, ${d.distinctAngles} facets) — ${pct(d.topAngleShare)} are "${d.topAngle}"`,
    );
    textBlocks.push(`BREADTH FLAGS\n${intro}\n\n${lines.join('\n')}`);

    const rows = narrowDomains
      .map(
        (d) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(d.domain)} <span style="color:#888;">(${d.depth}q · ${d.distinctAngles} facets)</span></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(d.topAngle)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#555;">${pct(d.topAngleShare)}</td>
      </tr>`,
      )
      .join('');
    htmlBlocks.push(`
      <h3 style="font-size:15px;margin:18px 0 4px;">Breadth flags</h3>
      <p style="margin:0 0 8px;">${escapeHtml(intro)}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#888;font-size:12px;">
            <th style="padding:6px 10px;">Domain (depth · facets)</th>
            <th style="padding:6px 10px;">Dominant facet</th>
            <th style="padding:6px 10px;text-align:right;">Share</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  const text = `${textBlocks.join('\n\n')}\n\n(Depth = questions filed under that label.)`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;">
      ${htmlBlocks.join('\n')}
      <p style="color:#888;font-size:12px;margin-top:14px;">Depth = questions filed under that label. Generated by the weekly domain-fragmentation cron.</p>
    </div>`;

  return { subject, html, text };
}
