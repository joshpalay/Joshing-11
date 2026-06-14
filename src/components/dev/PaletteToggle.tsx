'use client';

import { useSyncExternalStore, type CSSProperties } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// TESTING ONLY — card-background cycler (repurposed from the palette preview bar).
//
// Cycles the `--brand-card` token — the resting feed-card surface — AND the
// `--feed-card-elevated` token (the warm fill behind the "For You" home-zone
// cards) through the SANCTIONED background colors (globals.css), so a tester can
// audit how the cards read on each cream / wash without per-page edits. Every
// surface that fills with `var(--brand-card)` or `var(--feed-card-elevated)`
// recolors automatically.
//
// Only the system's own background tokens are offered (no off-palette hex), so
// nothing here introduces an unsanctioned color. Inline styles are on purpose:
// this is chrome, not app surface, so it sits outside the brand-token lint.
//
// Remove this component (and the boot script in layout.tsx) before merging to a
// shipping branch. The boot script applies the saved choice pre-paint.
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

// The two primary-button fill candidates. Both .btn-primary and the login submit
// read --btn-primary-bg, so flipping this recolors page CTAs and the login button
// together — letting a tester compare the two and pick one. Slate (index 0) is the
// globals.css default, so selecting it clears the override.
const BTN_COLORS: CardBg[] = [
  { label: 'Slate', value: 'var(--brand-link)', swatch: 'var(--brand-link)' },
  { label: 'Navy', value: 'var(--brand-navy)', swatch: 'var(--brand-navy)' },
];

const BTN_STORAGE_KEY = 'joshing-btn-color';
const BTN_COLOR_EVENT = 'joshing-btn-color-change';

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

function subscribeBtn(onChange: () => void) {
  window.addEventListener(BTN_COLOR_EVENT, onChange);
  return () => window.removeEventListener(BTN_COLOR_EVENT, onChange);
}
function readBtnSnapshot(): number {
  const raw = document.documentElement.getAttribute('data-btn-color');
  const i = raw ? Number(raw) : 0;
  return Number.isInteger(i) && i >= 0 && i < BTN_COLORS.length ? i : 0;
}

export function PaletteToggle() {
  const index = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);
  const btnIndex = useSyncExternalStore(subscribeBtn, readBtnSnapshot, serverSnapshot);

  function applyBtn(next: number) {
    const i = ((next % BTN_COLORS.length) + BTN_COLORS.length) % BTN_COLORS.length;
    const { value } = BTN_COLORS[i];
    const root = document.documentElement;
    // Slate (index 0) is the globals.css default — clear the override; else set it.
    if (i === 0) {
      root.style.removeProperty('--btn-primary-bg');
    } else {
      root.style.setProperty('--btn-primary-bg', value);
    }
    root.setAttribute('data-btn-color', String(i));
    try {
      localStorage.setItem(BTN_STORAGE_KEY, String(i));
    } catch {
      /* private mode / disabled storage — non-fatal */
    }
    window.dispatchEvent(new Event(BTN_COLOR_EVENT));
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
  const currentBtn = BTN_COLORS[btnIndex];

  return (
    <div
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

      {/* BUTTON COLOR — flip the primary-button fill between the two candidates so
          page CTAs and the login submit recolor together for a side-by-side call. */}
      <span style={{ fontWeight: 700, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
        BUTTON
      </span>
      <button
        type="button"
        onClick={() => applyBtn(btnIndex + 1)}
        aria-label={`Button color: ${currentBtn.label}. Tap to toggle.`}
        style={cycleStyle}
      >
        <Swatch color={currentBtn.swatch} active />
        {currentBtn.label}
        <span aria-hidden style={{ opacity: 0.6 }}>→</span>
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
