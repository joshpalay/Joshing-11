// Shared building blocks for Joshing's HTML emails (daily reminder, weekly
// friends note). Email HTML can't read CSS custom properties, so the design
// tokens are inlined here once.

// Brand palette — mirrors the design-system tokens in src/app/globals.css.
// Email HTML can't read CSS custom properties (no :root in mail clients), so
// the token values are inlined here. Keep these in lockstep with globals.css:
//   CREAM      → --brand-cream-page (#fcf8f2)   app page surface
//   CARD       → --brand-card       (#fdfcfb)   content card surface
//   INK        → --brand-ink        (#0a1f3d)   primary text / headings (navy)
//   INK_SOFT   → --brand-ink-700    (#3a4a5f)   secondary text
//   INK_FAINT  → --brand-ink-400    (#8a8a8a)   muted / fine print
//   RULE       → --brand-border     (#e9e2d2)   warm hairline border/divider
//   NAVY       → --brand-navy       (#1f3a5a)   primary button (== --btn-primary-bg)
//   ORANGE     → --brand-orange     (#d15e36)   accent links
export const CREAM = '#fcf8f2';
export const CARD = '#fdfcfb';
export const INK = '#0a1f3d';
export const INK_SOFT = '#3a4a5f';
export const INK_FAINT = '#8a8a8a';
export const RULE = '#e9e2d2';
export const NAVY = '#1f3a5a';
export const ORANGE = '#d15e36';

export const SERIF = "Georgia,'Times New Roman',serif";
export const SANS = "'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

// The brand triangle motif (public/images/Variant4.png) is a tileable pattern;
// rendered as a repeating banner band atop the card, it echoes the login
// screens' TriangleBackground without relying on a full-bleed cover crop.
export const TRIANGLE_IMAGE_PATH = '/images/Variant4.png';

// The triangle-motif header band. The artwork is tileable, so a repeating
// background on a fixed-height cell reads as a clean strip across the card top.
// Clients that drop background images (notably Outlook desktop) fall back to a
// solid brand-navy band — still on-brand. Omitted when no absolute URL resolves.
export function bannerRow(imageUrl: string | null): string {
  if (!imageUrl) return '';
  return `<tr>
              <td height="96" style="height:96px;background-color:${NAVY};background-image:url('${imageUrl}');background-repeat:repeat;background-position:center top;border-radius:12px 12px 0 0;font-size:0;line-height:0;mso-line-height-rule:exactly;" aria-hidden="true">&nbsp;</td>
            </tr>`;
}

export function divider(): string {
  return `<tr><td style="padding:24px 0;"><div style="height:1px;line-height:1px;font-size:0;background:${RULE};">&nbsp;</div></td></tr>`;
}

// Build an absolute URL for the triangle artwork from the (absolute) dailyUrl's
// origin. Email clients require absolute asset URLs; if dailyUrl isn't a valid
// absolute URL the banner is skipped rather than emitting a broken image.
export function resolveTriangleImageUrl(dailyUrl: string): string | null {
  try {
    return new URL(TRIANGLE_IMAGE_PATH, dailyUrl).toString();
  } catch {
    return null;
  }
}

export function eyebrow(label: string): string {
  return `<tr><td style="font-family:${SANS};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${INK_FAINT};padding-bottom:14px;">${escapeHtml(label)}</td></tr>`;
}

export function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
