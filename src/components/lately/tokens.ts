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
// Warm highlighter swipe (the "Lately." headline) — derived from the one
// accent gold (STYLE-GUIDE-COLOR §4) lightened over the page cream, replacing
// the orphan literal #e9c97a (≈ visually identical mix).
export const HILITE = 'color-mix(in srgb, var(--accent-gold) 55%, var(--brand-cream-page))';

// Body font intentionally uses the project default (Montserrat via next/font);
// CSS var resolves to it. The mockup spec'd Inter — project decision to keep
// Montserrat (see CLAUDE.md + intentional comment in src/app/layout.tsx).
export const FF = 'var(--font-sans-body), -apple-system, system-ui, sans-serif';
// System voice (labels/metadata) — routed through the app-wide --font-mono token.
// The typewriter face (Courier New) was retired: --font-mono now resolves to the
// sans (Montserrat), so the System voice reads as caps + letterspacing in the sans
// rather than as a separate monospace face (STYLE-GUIDE-TYPE §2).
export const FM = 'var(--font-mono)';
// Editorial serif voice (the italic "Lately." headline + empty-state) — routed
// through the app-wide --font-serif token (Cormorant Garamond, italic loaded).
// Kept as an alias (rather than inlined at each call site) so the Lately
// consumers route through one place; --font-display (Playfair) was retired
// app-wide by B-TYPE-SERIF-CONSOLIDATION-01.
export const FS = 'var(--font-serif), Georgia, serif';
