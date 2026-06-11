// Re-pointed to the JOSHING brand palette so the Lately surface matches the
// rest of the app. The Playfair "Lately." flourish (FS) and warm highlighter
// (HILITE) are kept as intentional editorial character.
export const INK = '#0a1f3d'; // --brand-ink
export const INK2 = '#3a4a5f'; // --brand-ink-700
export const INK3 = '#8a8a8a'; // --brand-ink-400
export const CREAM = '#fcf8f2'; // --brand-cream-page
export const PAPER = '#fdfcfb'; // --brand-card
export const RULE = '#e9e2d2'; // --brand-border
export const HILITE = '#e9c97a'; // warm brand-aligned highlighter

// Body font intentionally uses the project default (Montserrat via next/font);
// CSS var resolves to it. The mockup spec'd Inter — project decision to keep
// Montserrat (see CLAUDE.md + intentional comment in src/app/layout.tsx).
export const FF = 'var(--font-sans-body), -apple-system, system-ui, sans-serif';
// System voice — routed through the app-wide mono token (Courier New first).
export const FM = 'var(--font-mono)';
export const FS = 'var(--font-display), Georgia, serif';
