'use client';

import { useSyncExternalStore, type CSSProperties } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// TESTING ONLY — proposed-palette preview switch (see _docs/STYLE-GUIDE-COLOR.md).
//
// Flips the `data-palette` attribute on <html>. The `:root[data-palette="proposed"]`
// override block in globals.css repoints the color *tokens*, so every surface
// that reads a token recolors automatically — no per-page edits. Surfaces still
// on hardcoded hex (the category systems, some golds) won't flip until they're
// routed onto tokens; that routing is the actual color build.
//
// Colors here are inline (not Tailwind classes) on purpose: this is chrome, not
// app surface, so it deliberately sits outside the brand-token lint.
//
// Remove this component (and the globals.css block) before merging to a shipping
// branch. The boot script in layout.tsx applies the saved choice pre-paint.
// ─────────────────────────────────────────────────────────────────────────────

type Palette = 'current' | 'proposed';

const STORAGE_KEY = 'joshing-palette';

// What the toggle visibly changes, so a tester knows where to look. Extend this
// as more color jobs (category, gold) get routed onto tokens.
const CHANGES: Array<{ label: string; from: string; to: string }> = [
  { label: 'WRONG WASH', from: '#c96b4a', to: '#a93b3b' },
  { label: 'WRONG TEXT', from: '#c33d14', to: '#c1121f' },
  { label: 'LITERATURE', from: '#c0392b', to: '#7d2c3f' },
  { label: 'LANGUAGE', from: '#4a7a5a', to: '#2e6e7e' },
];

const PALETTE_EVENT = 'joshing-palette-change';

// Read the live palette straight off the <html> attribute (the source of truth,
// also set by the boot script before paint). useSyncExternalStore keeps the
// control in sync without an effect-setState and without a hydration mismatch —
// the server snapshot is always 'current'.
function subscribe(onChange: () => void) {
  window.addEventListener(PALETTE_EVENT, onChange);
  return () => window.removeEventListener(PALETTE_EVENT, onChange);
}
function readSnapshot(): Palette {
  return document.documentElement.getAttribute('data-palette') === 'proposed' ? 'proposed' : 'current';
}
function serverSnapshot(): Palette {
  return 'current';
}

export function PaletteToggle() {
  const palette = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);

  function apply(next: Palette) {
    if (next === 'proposed') {
      document.documentElement.setAttribute('data-palette', 'proposed');
    } else {
      document.documentElement.removeAttribute('data-palette');
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode / disabled storage — non-fatal */
    }
    window.dispatchEvent(new Event(PALETTE_EVENT));
  }

  const proposed = palette === 'proposed';

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
        ⚠ PALETTE TEST
      </span>

      <div
        role="group"
        aria-label="Color palette preview"
        style={{
          display: 'inline-flex',
          padding: 2,
          gap: 2,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.08)',
        }}
      >
        <button type="button" onClick={() => apply('current')} style={segStyle(!proposed)}>
          Current
        </button>
        <button type="button" onClick={() => apply('proposed')} style={segStyle(proposed)}>
          Proposed
        </button>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        {CHANGES.map((c) => (
          <span key={c.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <span style={{ opacity: 0.8, letterSpacing: '0.04em' }}>{c.label}</span>
            <Swatch color={c.from} dim={proposed} />
            <span style={{ opacity: 0.5 }}>→</span>
            <Swatch color={c.to} dim={!proposed} />
          </span>
        ))}
      </div>
    </div>
  );
}

function segStyle(active: boolean): CSSProperties {
  return {
    appearance: 'none',
    border: 'none',
    cursor: 'pointer',
    borderRadius: 999,
    padding: '3px 12px',
    fontSize: 12,
    fontWeight: 600,
    background: active ? '#e7e1d4' : 'transparent',
    color: active ? '#11161c' : '#e7e1d4',
    transition: 'background 120ms ease, color 120ms ease',
  };
}

function Swatch({ color, dim }: { color: string; dim: boolean }) {
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
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.25)',
        opacity: dim ? 0.35 : 1,
        transition: 'opacity 120ms ease',
      }}
    />
  );
}
