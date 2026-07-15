import type { CSSProperties, ReactNode } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Ceremony "room" primitives — the full-bleed, full-color takeover shell shared
// by the weekly ceremony (src/app/ceremony/[ceremonyId]/page.tsx) and the
// one-time email-reminder interstitial (D-REMINDER-INTERSTITIAL-01). Extracted
// verbatim from the ceremony page so the two surfaces share one room shell
// rather than drifting apart. Colors come from the --ceremony-* token ramp in
// globals.css — no inline hex. These are pure presentational components (no
// hooks), so they work in both server and client trees.
// ─────────────────────────────────────────────────────────────────────────────

const MONO = 'var(--font-mono)';

// ── Per-room theme (token-backed) ───────────────────────────────────────────
export type RoomTheme = { bg: string; fg: string; accent: string; sub: string };

export function roomTheme(name: string): RoomTheme {
  return {
    bg: `var(--ceremony-${name}-bg)`,
    fg: `var(--ceremony-${name}-fg)`,
    accent: `var(--ceremony-${name}-accent)`,
    sub: `var(--ceremony-${name}-sub)`,
  };
}

export function Reveal({
  show,
  delay = 0,
  reduced,
  children,
  style,
}: {
  show: boolean;
  delay?: number;
  reduced: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        opacity: show ? 1 : 0,
        transform: show ? 'translateY(0)' : 'translateY(16px)',
        transition: reduced
          ? 'none'
          : `opacity .65s ease ${delay}s, transform .65s cubic-bezier(.2,.7,.2,1) ${delay}s`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children, color }: { children: ReactNode; color: string }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: 4,
        textTransform: 'uppercase',
        color,
        marginBottom: 20,
      }}
    >
      {children}
    </div>
  );
}

export function Shell({ th, children }: { th: RoomTheme; children: ReactNode }) {
  // A room centers its content when it fits, but a tall beat (long question
  // text, a long domain list) can exceed the viewport. `justify-content: center`
  // would clip the overflow off both edges with no way to read it, so instead we
  // let the room scroll and center via auto margins on the child — auto margins
  // collapse to 0 when content overflows, keeping the top reachable rather than
  // clipped. Extra top/bottom padding clears the pips and the "tap to continue"
  // hint. Vertical drags scroll; a tap still advances (handled on <main>).
  return (
    <div
      className="ceremony-room-in"
      style={{
        position: 'absolute',
        inset: 0,
        background: th.bg,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: '72px 30px calc(72px + env(safe-area-inset-bottom))',
      }}
    >
      <div className="w-full max-w-md" style={{ margin: 'auto' }}>
        {children}
      </div>
    </div>
  );
}
