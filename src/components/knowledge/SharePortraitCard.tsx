import { forwardRef, type CSSProperties } from 'react';
import type { MasteryTier } from '@/types/db';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';
import { KNOWLEDGE_TIER_LABEL } from '@/server/profile/knowledge-tier-copy';
import { DOMAIN_ICON_COMPONENTS } from '@/components/icons/domain-icons';

// ── Palette & fonts (intentionally literal — do NOT tokenize) ────────────────────
//
// This card is never rendered as live, re-themeable DOM: SharePortraitModal
// snapshots it with html2canvas (scale 3) into a PNG for native share / download.
// html2canvas can't read CSS custom properties, doesn't understand color-mix(),
// and the app's hashed Next-font `--font-*` variables aren't reliably available to
// a detached canvas render — so every value here is a literal that mirrors the
// live Knowledge Portrait card (KnowledgeCard.tsx + DomainCircle.tsx). The goal is
// that the shared image looks like the on-screen "Your Knowledge Portrait" card,
// not a separate aesthetic. The modal hand-loads the three concrete font files
// (Cormorant Garamond / Montserrat / Josefin Sans) so the snapshot has real fonts.
//
// LOCKSTEP: keep these literals in sync, value-for-value, with the tokens they
// mirror in globals.css. If a token changes, change it here in the SAME edit or
// the share image silently drifts.
//   --brand-ink         #0a1f3d   (primary text)
//   --brand-ink-400     #8a8a8a   (muted text)
//   --brand-cream-card  #fbf5e9   (card surface)
//   --brand-border      #e9e2d2   (hairline)
//   --cat-*             the per-domain hue scale below
const INK = '#0a1f3d';
const INK_MUTED = '#8a8a8a';
const CREAM_CARD = '#fbf5e9';
const BORDER = '#e9e2d2';

// Literal font families. The concrete files are loaded by SharePortraitModal via
// the FontFace API before capture (the live card resolves these through
// --font-serif / --font-wordmark / --font-sans-body).
const FF_SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
const FF_WORDMARK = "'Montserrat', system-ui, -apple-system, sans-serif";
const FF_SANS = "'Josefin Sans', system-ui, -apple-system, sans-serif";

// Per-domain primary/text colors — mirrors the --cat-* token scale in globals.css.
type DomainColor = { primary: string; text: string };
const DOMAIN_COLORS: Record<string, DomainColor> = {
  Literature: { primary: '#7d2c3f', text: '#571f2c' },
  Music: { primary: '#1a6b8a', text: '#0e4060' },
  'Film & Television': { primary: '#6b3fa0', text: '#3d1f6b' },
  'Architecture & Design': { primary: '#b07d2e', text: '#7a5010' },
  'Food & Cuisine': { primary: '#2e8b57', text: '#0e5c30' },
  Technology: { primary: '#3a6b8a', text: '#1a3f5c' },
  Sports: { primary: '#c06b1a', text: '#8b3e0e' },
  History: { primary: '#5a6b7a', text: '#2a3f50' },
  Science: { primary: '#5a7a2e', text: '#2a4a0e' },
  Philosophy: { primary: '#7a5a8a', text: '#4a2a5c' },
  'Pop Culture': { primary: '#8a2a4a', text: '#5c0e2a' },
  Language: { primary: '#2e6e7e', text: '#173f4a' },
};

// Deterministic hash hue for domains outside the --cat-* scale. Mirrors the
// hashColor() in PortraitCircles (hsl 45%/35% primary, 45%/25% text) so an
// unknown domain keeps the same color it has on the live portrait.
function hashColor(str: string): DomainColor {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  return { primary: `hsl(${hue},45%,35%)`, text: `hsl(${hue},45%,25%)` };
}

function getDomainColor(broadCategory: string | null | undefined): DomainColor {
  const normalized = normalizeBroadCategory(broadCategory) ?? null;
  if (!normalized) return { primary: '#8a8a8a', text: '#3a4a5f' };
  return DOMAIN_COLORS[normalized] ?? hashColor(normalized);
}

// rgb extraction for hex and the hsl() hash fallback — html2canvas can't compute
// color-mix(), so the soft bubble gradient is built from explicit rgba() stops.
function toRgb(color: string): { r: number; g: number; b: number } {
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  const m = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  const hue = m ? parseInt(m[1]) : 200;
  const s = (m ? parseInt(m[2]) : 45) / 100;
  const l = (m ? parseInt(m[3]) : 35) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const tt = ((t % 1) + 1) % 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const hn = hue / 360;
  return {
    r: Math.round(channel(hn + 1 / 3) * 255),
    g: Math.round(channel(hn) * 255),
    b: Math.round(channel(hn - 1 / 3) * 255),
  };
}

// Mirrors domainBubbleGradient() (KnowledgeBubble.tsx): a soft radial fill at
// 22% → 12% opacity. color-mix(in srgb, base X%, transparent) === rgba(base, X/100).
function bubbleGradient(primary: string): string {
  const { r, g, b } = toRgb(primary);
  return `radial-gradient(circle at 38% 38%, rgba(${r},${g},${b},0.22), rgba(${r},${g},${b},0.12))`;
}

// ── Circle sizing — mirrors KnowledgeCard.getCircleDiameter (mobile scale) ───────
const MIN_DIAMETER = 28;
const MAX_DIAMETER = 64;

function getDiameter(points: number, maxPoints: number): number {
  const ratio = maxPoints > 0 ? points / maxPoints : 0;
  return Math.round(MIN_DIAMETER + ratio * (MAX_DIAMETER - MIN_DIAMETER));
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type ShareDomain = {
  canonicalSubcategory: string;
  currentTier: MasteryTier;
  lifetimePoints: number;
  iconKey: string;
  broadCategory?: string | null;
};

export type SharePortraitCardProps = {
  playerDisplayName: string;
  portraitStatement: string;
  domains: ShareDomain[];
  overflowCount: number;
  tierSignature: string;
};

// ── Circle ───────────────────────────────────────────────────────────────────────

function ShareCircle({
  domain,
  diameter,
  slotSize,
}: {
  domain: ShareDomain;
  diameter: number;
  slotSize: number;
}) {
  const color = getDomainColor(domain.broadCategory);
  const iconSize = Math.round(diameter * 0.4);
  const Icon = (
    DOMAIN_ICON_COMPONENTS as Record<
      string,
      (typeof DOMAIN_ICON_COMPONENTS)[keyof typeof DOMAIN_ICON_COMPONENTS] | undefined
    >
  )[domain.iconKey];

  return (
    <div style={{ ...circleItemStyle, width: Math.max(80, slotSize + 20) }}>
      <div style={{ ...circleSlotStyle, width: slotSize, height: slotSize }}>
        <div
          style={{
            width: diameter,
            height: diameter,
            borderRadius: '50%',
            background: bubbleGradient(color.primary),
            border: `1px solid ${color.primary}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {Icon ? <Icon size={iconSize} color={INK} /> : null}
        </div>
      </div>
      <p style={circleNameStyle}>{domain.canonicalSubcategory}</p>
      <p style={circleTierStyle}>{KNOWLEDGE_TIER_LABEL[domain.currentTier]}</p>
    </div>
  );
}

// ── Card ───────────────────────────────────────────────────────────────────────

export const SharePortraitCard = forwardRef<HTMLDivElement, SharePortraitCardProps>(
  function SharePortraitCard(
    { playerDisplayName, portraitStatement, domains, overflowCount, tierSignature },
    ref,
  ) {
    const sorted = [...domains].sort((a, b) => b.lifetimePoints - a.lifetimePoints);
    const visible = sorted.slice(0, 5);
    const maxPoints = visible[0]?.lifetimePoints ?? 1;
    const diameters = visible.map((d) => getDiameter(d.lifetimePoints, maxPoints));
    const slotSize = Math.max(...diameters, 0);
    const totalOverflow = overflowCount + Math.max(0, sorted.length - visible.length);

    return (
      <div ref={ref} style={cardStyle}>
        <p style={wordmarkStyle}>Joshing</p>
        <div aria-hidden="true" style={triangleStripStyle} />
        <p style={titleStyle}>Your Knowledge Portrait</p>

        <p style={statementStyle}>{portraitStatement}</p>

        <div style={circlesWrapStyle}>
          {visible.map((domain, i) => (
            <ShareCircle
              key={domain.canonicalSubcategory}
              domain={domain}
              diameter={diameters[i] ?? MIN_DIAMETER}
              slotSize={slotSize}
            />
          ))}
        </div>

        {totalOverflow > 0 && (
          <p style={overflowStyle}>+{totalOverflow} more territories</p>
        )}

        <p style={tierSignatureStyle}>{tierSignature}</p>
        <p style={attributionStyle}>{playerDisplayName} on Joshing</p>
      </div>
    );
  },
);

// ── Styles (mirror KnowledgeCard.tsx) ────────────────────────────────────────────

const cardStyle: CSSProperties = {
  width: 360,
  boxSizing: 'border-box',
  background: CREAM_CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  boxShadow: '0 4px 12px rgba(40, 32, 30, 0.04)',
  padding: '18px 16px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const wordmarkStyle: CSSProperties = {
  margin: 0,
  fontFamily: FF_WORDMARK,
  fontWeight: 600,
  fontSize: 15,
  color: INK,
  letterSpacing: '0.01em',
  lineHeight: 1,
};

// The JOSHING triangle band that sits under the wordmark, mirroring
// CardTriangleStrip on the live card. The negative inline margin bleeds it to
// the card's inner border edge; it matches cardStyle's 16px horizontal padding
// (CardTriangleStrip's own -0.95rem is tied to the live card's padding instead).
// Same artwork as the live strip so the snapshot keeps the palette consistent.
const triangleStripStyle: CSSProperties = {
  height: 16,
  marginInline: -16,
  backgroundImage: 'url(/images/Variant4-TOP.png)',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
};

const titleStyle: CSSProperties = {
  margin: 0,
  color: INK,
  fontFamily: FF_SANS,
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};

const statementStyle: CSSProperties = {
  margin: 0,
  fontFamily: FF_SERIF,
  fontSize: 22,
  fontWeight: 500,
  color: INK,
  lineHeight: 1.3,
  letterSpacing: '0.01em',
};

const circlesWrapStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  alignItems: 'flex-start',
  columnGap: 16,
  rowGap: 18,
  marginTop: 2,
};

const circleItemStyle: CSSProperties = {
  textAlign: 'center',
};

const circleSlotStyle: CSSProperties = {
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const circleNameStyle: CSSProperties = {
  margin: '8px 0 0',
  fontSize: 11,
  fontFamily: FF_SANS,
  color: INK,
  lineHeight: 1.25,
  overflowWrap: 'anywhere',
};

const circleTierStyle: CSSProperties = {
  margin: '2px 0 0',
  fontSize: 10,
  fontFamily: FF_SANS,
  color: INK_MUTED,
};

const overflowStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontFamily: FF_SANS,
  color: INK_MUTED,
  textAlign: 'center',
};

const tierSignatureStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontFamily: FF_SANS,
  color: INK,
};

const attributionStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontFamily: FF_SANS,
  color: INK_MUTED,
};
