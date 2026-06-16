'use client';

import { useSyncExternalStore, type CSSProperties } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// TESTING ONLY — design audit bar (repurposed from the palette preview bar).
//
// Two controls, both for auditing the design system without per-page edits:
//
//  1. Card-background cycler — cycles the `--brand-card` token (the resting
//     feed-card surface) AND `--feed-card-elevated` (the warm fill behind the
//     "For You" home-zone cards) through the SANCTIONED background colors
//     (globals.css). Every surface that fills with `var(--brand-card)` or
//     `var(--feed-card-elevated)` recolors automatically.
//
//  2. Flat toggle — sets `data-flat="1"` on <html>, which the globals.css flat
//     rule reads to strip every corner radius and drop shadow app-wide, so a
//     tester can read the layout without rounding / elevation. The bar's own
//     chrome is excluded (it carries `palette-bar`) so the controls stay legible.
//
// Only the system's own background tokens are offered (no off-palette hex), so
// nothing here introduces an unsanctioned color. Inline styles are on purpose:
// this is chrome, not app surface, so it sits outside the brand-token lint.
//
// Remove this component (and the boot script in layout.tsx, plus the
// `html[data-flat]` rule in globals.css) before merging to a shipping branch.
// The boot script applies the saved choices pre-paint.
// ─────────────────────────────────────────────────────────────────────────────

type CardBg = { label: string; value: string; swatch: string };

// Each entry is a sanctioned background token. 'Default' clears the override
// (back to --brand-card's own value, #fdfcfb).
const CARD_BGS: CardBg[] = [
  { label: 'Default', value: '', swatch: '#fdfcfb' },
  { label: 'Cream page', value: 'var(--brand-cream-page)', swatch: 'var(--brand-cream-page)' },
  { label: 'Warm cream', value: 'var(--brand-cream-card)', swatch: 'var(--brand-cream-card)' },
  { label: 'Cream accent', value: 'var(--brand-cream)', swatch: 'var(--brand-cream)' },
  { label: 'Question', value: 'var(--game-card-question)', swatch: 'var(--game-card-question)' },
  { label: 'Parchment', value: 'var(--editorial-parchment)', swatch: 'var(--editorial-parchment)' },
  { label: 'Sage', value: 'var(--editorial-sage)', swatch: 'var(--editorial-sage)' },
  { label: 'Slate', value: 'var(--editorial-slate)', swatch: 'var(--editorial-slate)' },
];

const STORAGE_KEY = 'joshing-card-bg';
const CARD_BG_EVENT = 'joshing-card-bg-change';

const FLAT_KEY = 'joshing-flat';
const FLAT_EVENT = 'joshing-flat-change';

const JOSEFIN_KEY = 'joshing-josefin';
const JOSEFIN_EVENT = 'joshing-josefin-change';

// Read the live choice straight off the <html> attribute (the source of truth,
// also set by the boot script before paint). useSyncExternalStore keeps the
// control in sync without an effect-setState and without a hydration mismatch —
// the server snapshot is always the default (index 0).
function subscribe(onChange: () => void) {
  window.addEventListener(CARD_BG_EVENT, onChange);
  return () => window.removeEventListener(CARD_BG_EVENT, onChange);
}
function readSnapshot(): number {
  const raw = document.documentElement.getAttribute('data-card-bg');
  const i = raw ? Number(raw) : 0;
  return Number.isInteger(i) && i >= 0 && i < CARD_BGS.length ? i : 0;
}
function serverSnapshot(): number {
  return 0;
}

// Flat toggle — mirrors the card-bg store, reading the live choice off the
// <html> `data-flat` attribute (also set pre-paint by the boot script).
function subscribeFlat(onChange: () => void) {
  window.addEventListener(FLAT_EVENT, onChange);
  return () => window.removeEventListener(FLAT_EVENT, onChange);
}
function readFlat(): boolean {
  return document.documentElement.getAttribute('data-flat') === '1';
}
function serverFlat(): boolean {
  return false;
}

// Josefin toggle — mirrors the flat store, reading the live choice off the
// <html> `data-josefin` attribute (also set pre-paint by the boot script). When
// on, globals.css repoints the sans body font at Josefin Sans app-wide.
function subscribeJosefin(onChange: () => void) {
  window.addEventListener(JOSEFIN_EVENT, onChange);
  return () => window.removeEventListener(JOSEFIN_EVENT, onChange);
}
function readJosefin(): boolean {
  return document.documentElement.getAttribute('data-josefin') === '1';
}
function serverJosefin(): boolean {
  return false;
}

export function PaletteToggle() {
  const index = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);
  const flat = useSyncExternalStore(subscribeFlat, readFlat, serverFlat);
  const josefin = useSyncExternalStore(subscribeJosefin, readJosefin, serverJosefin);

  function toggleFlat() {
    const next = !flat;
    const root = document.documentElement;
    if (next) root.setAttribute('data-flat', '1');
    else root.removeAttribute('data-flat');
    try {
      localStorage.setItem(FLAT_KEY, next ? '1' : '0');
    } catch {
      /* private mode / disabled storage — non-fatal */
    }
    window.dispatchEvent(new Event(FLAT_EVENT));
  }

  function toggleJosefin() {
    const next = !josefin;
    const root = document.documentElement;
    if (next) root.setAttribute('data-josefin', '1');
    else root.removeAttribute('data-josefin');
    try {
      localStorage.setItem(JOSEFIN_KEY, next ? '1' : '0');
    } catch {
      /* private mode / disabled storage — non-fatal */
    }
    window.dispatchEvent(new Event(JOSEFIN_EVENT));
  }

  function apply(next: number) {
    const i = ((next % CARD_BGS.length) + CARD_BGS.length) % CARD_BGS.length;
    const { value } = CARD_BGS[i];
    const root = document.documentElement;
    if (value) {
      root.style.setProperty('--brand-card', value);
      // The "For You" home-zone cards fill with --feed-card-elevated (the warm
      // game-card cream), not --brand-card, so drive it too — otherwise those
      // cards stay put while the rest of the feed recolors. Default clears the
      // override, restoring the token's globals.css value (game-card cream).
      root.style.setProperty('--feed-card-elevated', value);
    } else {
      root.style.removeProperty('--brand-card');
      root.style.removeProperty('--feed-card-elevated');
    }
    root.setAttribute('data-card-bg', String(i));
    try {
      localStorage.setItem(STORAGE_KEY, String(i));
    } catch {
      /* private mode / disabled storage — non-fatal */
    }
    window.dispatchEvent(new Event(CARD_BG_EVENT));
  }

  const current = CARD_BGS[index];

  return (
    <div
      className="palette-bar"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 16px',
        fontSize: 12,
        lineHeight: 1.2,
        background: '#11161c',
        color: '#e7e1d4',
        borderBottom: '1px solid rgba(255,255,255,0.12)',
      }}
    >
      <span style={{ fontWeight: 700, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
        ⚠ CARD COLOR
      </span>

      {/* The toggle: each tap advances to the next background color. */}
      <button
        type="button"
        onClick={() => apply(index + 1)}
        aria-label={`Card background: ${current.label}. Tap to cycle.`}
        style={cycleStyle}
      >
        <Swatch color={current.swatch} active />
        {current.label}
        <span aria-hidden style={{ opacity: 0.6 }}>→</span>
      </button>

      {/* Flat toggle: strip every corner radius and drop shadow app-wide. */}
      <button
        type="button"
        onClick={toggleFlat}
        aria-pressed={flat}
        aria-label={`Flat mode (no rounded corners or shadows): ${flat ? 'on' : 'off'}. Tap to toggle.`}
        style={{ ...flatStyle, ...(flat ? flatStyleOn : null) }}
      >
        {flat ? '▣' : '▢'} Flat
      </button>

      {/* Josefin toggle: swap the sans-serif body font to Josefin Sans app-wide. */}
      <button
        type="button"
        onClick={toggleJosefin}
        aria-pressed={josefin}
        aria-label={`Josefin Sans font: ${josefin ? 'on' : 'off'}. Tap to toggle.`}
        style={{ ...flatStyle, ...(josefin ? flatStyleOn : null) }}
      >
        {josefin ? '▣' : '▢'} Josefin
      </button>

      {/* Jump straight to any background. */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {CARD_BGS.map((bg, i) => (
          <button
            key={bg.label}
            type="button"
            onClick={() => apply(i)}
            aria-label={bg.label}
            title={bg.label}
            style={{
              appearance: 'none',
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
              lineHeight: 0,
            }}
          >
            <Swatch color={bg.swatch} active={i === index} />
          </button>
        ))}
      </div>
    </div>
  );
}

const cycleStyle: CSSProperties = {
  appearance: 'none',
  border: 'none',
  cursor: 'pointer',
  borderRadius: 999,
  padding: '3px 12px 3px 6px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  fontWeight: 600,
  background: '#e7e1d4',
  color: '#11161c',
};

const flatStyle: CSSProperties = {
  appearance: 'none',
  cursor: 'pointer',
  borderRadius: 999,
  padding: '3px 12px',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  border: '1px solid rgba(231, 225, 212, 0.5)',
  background: 'transparent',
  color: '#e7e1d4',
};

const flatStyleOn: CSSProperties = {
  background: '#e7e1d4',
  color: '#11161c',
  borderColor: '#e7e1d4',
};

function Swatch({ color, active }: { color: string; active: boolean }) {
  return (
    <span
      aria-hidden="true"
      title={color}
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        borderRadius: 3,
        background: color,
        boxShadow: active
          ? '0 0 0 2px #e7e1d4, 0 0 0 3px #11161c'
          : 'inset 0 0 0 1px rgba(255,255,255,0.25)',
      }}
    />
  );
}
