import { forwardRef, type CSSProperties } from 'react';
import type { PortraitEntry } from '@/components/knowledge/PortraitCircles';

// ── Palette (intentionally literal — do NOT tokenize) ───────────────────────────
//
// This card is never rendered as live, re-themeable DOM: SharePortraitModal
// snapshots it with html2canvas (scale 3) into a PNG for native share / download.
// The literal hex values and literal font names ('Courier New' / 'Playfair
// Display') are load-bearing for that raster path — the modal hand-loads Playfair
// via the FontFace API so the detached canvas render has a concrete font file, and
// the app's hashed `--font-*` Next-font variables are not reliably available to
// html2canvas. A snapshot also never re-themes, so var(--brand-*) tokens would buy
// nothing here. This is the deliberate "receipt" share aesthetic; keep it literal.
// (See the 2026-05-30 design audit — share-card bucket.)

const INK = '#0e0e0e';
const INK2 = '#3a3a3a';
const INK3 = '#8a8a8a';
const CREAM = '#faf8f2';
const RULE = '#e0dbd0';
const FM = "'Courier New', monospace";
const FP = "'Playfair Display', Georgia, serif";

// Domain color palette — every domain must have a distinct color, no grey fallback.
//
// LOCKSTEP: these literals MUST mirror the `--cat-*` tokens in globals.css
// value-for-value. html2canvas can't read CSS variables, so this raster path
// hardcodes the scale; if the tokens change, change these in the SAME edit or
// the share image silently drifts to the old (collision-prone) colors.
const DOMAIN_COLORS: Record<string, string> = {
  // Slug keys (from portrait API broad_category)
  Literature: '#7d2c3f', // --cat-literature (bordeaux; de-collided from grading red)
  Music: '#1a6b8a',
  'Film & Television': '#6b3fa0',
  'Film & TV': '#6b3fa0',
  'Architecture & Design': '#b07d2e',
  'Food & Cuisine': '#2e8b57',
  Technology: '#3a6b8a',
  Sports: '#c06b1a',
  Sport: '#c06b1a',
  History: '#5a6b7a',
  Science: '#5a7a2e',
  Philosophy: '#7a5a8a',
  'Pop Culture': '#8a2a4a',
  Language: '#2e6e7e', // --cat-language (teal; de-collided from CORRECT green)
};

function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  const hue = ((Math.abs(h) % 300) + 30) % 360; // avoid grey range 0–30 and 300–360
  return `hsl(${hue},55%,35%)`;
}

function getDomainColor(broadCategory: string): string {
  return DOMAIN_COLORS[broadCategory] ?? hashColor(broadCategory);
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  // Handle hsl() colors from hashColor by approximating via a canvas trick isn't available SSR,
  // so we'll do a simple hash-based fallback for non-hex colors
  if (!color.startsWith('#')) {
    // hsl(hue, 55%, 35%) — extract hue and convert manually (simplified)
    const m = color.match(/hsl\((\d+)/);
    const hue = m ? parseInt(m[1]) : 180;
    const h = hue / 360;
    const s = 0.55;
    const l = 0.35;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const toRgb = (t: number) => {
      const tt = ((t % 1) + 1) % 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    return {
      r: Math.round(toRgb(h + 1 / 3) * 255),
      g: Math.round(toRgb(h) * 255),
      b: Math.round(toRgb(h - 1 / 3) * 255),
    };
  }
  return {
    r: parseInt(color.slice(1, 3), 16),
    g: parseInt(color.slice(3, 5), 16),
    b: parseInt(color.slice(5, 7), 16),
  };
}

// ── Bubble ─────────────────────────────────────────────────────────────────────

function Bubble({ points, maxPoints, broadCategory, size }: {
  points: number;
  maxPoints: number;
  broadCategory: string;
  size: number;
}) {
  const normalized = points / Math.max(maxPoints, 1);
  const opacity = 0.25 + normalized * 0.75;
  const color = getDomainColor(broadCategory);
  const { r, g, b } = hexToRgb(color);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at 36% 33%, rgba(${r},${g},${b},1), rgba(${r},${g},${b},0.55))`,
        opacity,
        flexShrink: 0,
      }}
    />
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type SharePortraitCardProps = {
  entries: PortraitEntry[];
  playerDisplayName: string;
};

// ── Card ───────────────────────────────────────────────────────────────────────

export const SharePortraitCard = forwardRef<HTMLDivElement, SharePortraitCardProps>(
  function SharePortraitCard({ entries, playerDisplayName }, ref) {
    const valid = entries
      .filter((e) => e.totalMasteryPoints > 0 && e.broadCategory && e.broadCategory !== 'General Knowledge' && e.broadCategory !== 'general_knowledge' && e.broadCategory !== 'other')
      .sort((a, b) => b.totalMasteryPoints - a.totalMasteryPoints);

    const maxPoints = valid.length > 0 ? valid[0].totalMasteryPoints : 1;
    const top1 = valid[0];
    const top2to5 = valid.slice(1, 5);
    const rest = valid.slice(5);

    // Footer dots: unique domains in order of first appearance
    const seenDomains = new Set<string>();
    const footerDomains: string[] = [];
    for (const e of valid) {
      if (!seenDomains.has(e.broadCategory)) {
        seenDomains.add(e.broadCategory);
        footerDomains.push(e.broadCategory);
      }
    }

    return (
      <div
        ref={ref}
        style={cardStyle}
      >
        {/* Header */}
        <div style={headerStyle}>
          <span style={headerLeftStyle}>{playerDisplayName}</span>
          <span style={headerRightStyle}>JOSHING</span>
        </div>

        <div style={bodyStyle}>
          {/* Rank 1 row */}
          {top1 && (
            <div style={rank1RowStyle}>
              <span style={rankLabelStyle}>1</span>
              <Bubble
                points={top1.totalMasteryPoints}
                maxPoints={maxPoints}
                broadCategory={top1.broadCategory}
                size={46}
              />
              <span style={rank1NameStyle}>{top1.canonicalSubcategory}</span>
            </div>
          )}

          {/* Ranks 2–5 */}
          {top2to5.length > 0 && (
            <div style={ranks2to5Style}>
              {top2to5.map((entry, i) => (
                <div key={entry.canonicalSubcategory} style={rank2to5RowStyle}>
                  <span style={rankLabelStyle}>{i + 2}</span>
                  <Bubble
                    points={entry.totalMasteryPoints}
                    maxPoints={maxPoints}
                    broadCategory={entry.broadCategory}
                    size={28}
                  />
                  <span style={rank2to5NameStyle}>{entry.canonicalSubcategory}</span>
                </div>
              ))}
            </div>
          )}

          {/* Also exploring */}
          {rest.length > 0 && (
            <div style={alsoExploringSection}>
              <div style={alsoExploringLabelStyle}>Also exploring</div>
              <div style={alsoExploringBubblesStyle}>
                {rest.map((entry) => {
                  const size = 11 + (entry.totalMasteryPoints / maxPoints) * 14;
                  return (
                    <Bubble
                      key={entry.canonicalSubcategory}
                      points={entry.totalMasteryPoints}
                      maxPoints={maxPoints}
                      broadCategory={entry.broadCategory}
                      size={size}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <span style={footerLeftStyle}>joshing.app</span>
          <div style={footerDotsStyle}>
            {footerDomains.map((domain) => (
              <div
                key={domain}
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  backgroundColor: getDomainColor(domain),
                  opacity: 0.7,
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }
);

// ── Styles ─────────────────────────────────────────────────────────────────────

const cardStyle: CSSProperties = {
  width: 340,
  backgroundColor: CREAM,
  border: `1.5px solid ${INK}`,
  boxShadow: `3px 3px 0 ${INK2}`,
  fontFamily: FM,
};

const headerStyle: CSSProperties = {
  padding: '12px 16px',
  borderBottom: `1px solid ${RULE}`,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const headerLeftStyle: CSSProperties = {
  fontSize: 9,
  fontFamily: FM,
  letterSpacing: '0.2em',
  color: INK3,
  textTransform: 'uppercase',
};

const headerRightStyle: CSSProperties = {
  fontSize: 9,
  fontFamily: FM,
  letterSpacing: '0.18em',
  color: INK,
  textTransform: 'uppercase',
  fontWeight: 'bold',
};

const bodyStyle: CSSProperties = {
  padding: '16px 16px 0',
};

const rank1RowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingBottom: 13,
  borderBottom: `1px solid ${RULE}`,
  marginBottom: 12,
};

const rankLabelStyle: CSSProperties = {
  fontSize: 9,
  fontFamily: FM,
  color: INK3,
  width: 10,
  flexShrink: 0,
};

const rank1NameStyle: CSSProperties = {
  fontSize: 16,
  fontFamily: FP,
  fontStyle: 'italic',
  color: INK,
  lineHeight: 1.25,
};

const ranks2to5Style: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  marginBottom: 14,
};

const rank2to5RowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const rank2to5NameStyle: CSSProperties = {
  fontSize: 12,
  fontFamily: FP,
  fontStyle: 'italic',
  color: INK2,
  lineHeight: 1.3,
};

const alsoExploringSection: CSSProperties = {
  borderTop: `1px solid ${RULE}`,
  paddingTop: 13,
  paddingBottom: 16,
};

const alsoExploringLabelStyle: CSSProperties = {
  fontSize: 8,
  fontFamily: FM,
  letterSpacing: '0.15em',
  color: INK3,
  textTransform: 'uppercase',
  marginBottom: 10,
};

const alsoExploringBubblesStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  alignItems: 'center',
};

const footerStyle: CSSProperties = {
  borderTop: `1px solid ${RULE}`,
  padding: '8px 16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const footerLeftStyle: CSSProperties = {
  fontSize: 8,
  fontFamily: FM,
  color: INK3,
  letterSpacing: '0.1em',
};

const footerDotsStyle: CSSProperties = {
  display: 'flex',
  gap: 3,
  alignItems: 'center',
};
