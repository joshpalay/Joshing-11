// Ergonomic aliases over the CSS brand tokens (globals.css :root) — references,
// not copies, so the values can never drift from the app palette
// (STYLE-GUIDE-COLOR §2: one source of truth per neutral).
// NOTE: CREAM here is the PAGE cream (--brand-cream-page #fcf8f2) — the Lately
// surface sits on the page surface. The app-wide CSS alias `--cream` is the
// content-CARD cream (--brand-card, = PAPER below). Same word, two jobs; the
// per-job brand tokens are the disambiguation.
export const INK = 'var(--brand-ink)';
export const INK2 = 'var(--brand-ink-700)';
export const INK3 = 'var(--brand-ink-400)';
export const CREAM = 'var(--brand-cream-page)';
export const PAPER = 'var(--brand-card)';
export const RULE = 'var(--brand-border)';
// Warm highlighter — gold family; no CSS counterpart yet. Folding it into the
// one --accent-gold is color fix-list step 4 (gold), not the neutrals pass.
export const HILITE = '#e9c97a';

// Body font intentionally uses the project default (Montserrat via next/font);
// CSS var resolves to it. The mockup spec'd Inter — project decision to keep
// Montserrat (see CLAUDE.md + intentional comment in src/app/layout.tsx).
export const FF = 'var(--font-sans-body), -apple-system, system-ui, sans-serif';
// System voice — routed through the app-wide mono token (Courier New first).
export const FM = 'var(--font-mono)';
export const FS = 'var(--font-display), Georgia, serif';
