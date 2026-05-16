'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GameCircleItem = {
  canonical_subcategory: string;
  broad_category: string;
  points_before: number;
  points_after: number;
  tier_before: string;
  tier_after: string;
  new_territory: boolean;
};

export type RoundCircleItem = {
  canonical_subcategory: string;
  broad_category: string;
  points_total: number;
  points_gained_this_round: number;
  tier_current: string;
};

// Re-export for callers that imported getDomainColor from this module.
export function getDomainColor(broadCategory: string): string {
  return getPortraitDomainColor(broadCategory).primary;
}

// ── Circle sizing — matches PortraitCircles constants ─────────────────────────

const MIN_SIZE = 30;
const MAX_SIZE = 72;
const MIN_OPACITY = 0.22;
const SEED = 0.08;
const DURATION = 800;

function getCircleSize(pts: number, maxPts: number): number {
  const n = pts / Math.max(maxPts, 1);
  return Math.round(MIN_SIZE + n * (MAX_SIZE - MIN_SIZE));
}

function getCircleOpacity(pts: number, maxPts: number): number {
  const n = pts / Math.max(maxPts, 1);
  return MIN_OPACITY + n * (1 - MIN_OPACITY);
}

// ── Tier helpers ──────────────────────────────────────────────────────────────

const TIER_ORDER = ['Establishing', 'Familiar', 'Solid', 'Mastery'] as const;
type TierLabel = (typeof TIER_ORDER)[number];

function tierProgression(tierAfter: string): string {
  const idx = TIER_ORDER.indexOf(tierAfter as TierLabel);
  if (idx < 0) return tierAfter;
  const next = TIER_ORDER[idx + 1];
  return next ? `${tierAfter} → ${next}` : 'Mastery';
}

// ── Animated knowledge circle — matches PortraitDomainCircle visual style ─────

export function KnowledgeCircle({
  broadCategory,
  pointsAfter,
  maxPoints,
  animate,
  size,
}: {
  broadCategory: string;
  pointsAfter: number;
  maxPoints: number;
  animate: boolean;
  size?: number;
}) {
  const dc = getPortraitDomainColor(broadCategory);
  const resolvedSize = size ?? getCircleSize(pointsAfter, maxPoints);
  const slotSize = size ?? MAX_SIZE;
  const finalOpacity = getCircleOpacity(pointsAfter, maxPoints);
  const [opacity, setOpacity] = useState(animate ? MIN_OPACITY : finalOpacity);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) return;
    startRef.current = null;
    const tick = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const t = Math.min((ts - startRef.current) / DURATION, 1);
      // Ease out back — slight overshoot for satisfying pop
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const eased = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      setOpacity(Math.max(MIN_OPACITY, Math.min(1, MIN_OPACITY + (finalOpacity - MIN_OPACITY) * Math.max(0, Math.min(1.2, eased)))));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [animate, finalOpacity]);

  // Size-scale also animates: start small, grow to target
  const [scale, setScale] = useState(animate ? SEED : 1);
  const scaleRafRef = useRef<number | null>(null);
  const scaleStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) return;
    scaleStartRef.current = null;
    const tick = (ts: number) => {
      if (!scaleStartRef.current) scaleStartRef.current = ts;
      const t = Math.min((ts - scaleStartRef.current) / DURATION, 1);
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const eased = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      setScale(Math.max(SEED, Math.min(1.08, SEED + (1 - SEED) * Math.max(0, eased))));
      if (t < 1) scaleRafRef.current = requestAnimationFrame(tick);
    };
    scaleRafRef.current = requestAnimationFrame(tick);
    return () => { if (scaleRafRef.current !== null) cancelAnimationFrame(scaleRafRef.current); };
  }, [animate]);

  const displaySize = Math.round(resolvedSize * scale);

  return (
    <div
      style={{
        width: slotSize,
        height: slotSize,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: displaySize,
          height: displaySize,
          borderRadius: '50%',
          background: `radial-gradient(circle at 38% 38%, ${dc.light.replace('0.12', '0.22')}, ${dc.light})`,
          opacity,
          transition: animate ? undefined : 'none',
        }}
      />
    </div>
  );
}

// ── Game summary row ──────────────────────────────────────────────────────────

function GameCircleRow({
  item,
  index,
  maxPoints,
  isLast,
}: {
  item: GameCircleItem;
  index: number;
  maxPoints: number;
  isLast: boolean;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), index * 200);
    return () => clearTimeout(t);
  }, [index]);

  const dc = getPortraitDomainColor(item.broad_category);
  const tierChanged = item.tier_before !== item.tier_after;
  const pts = item.points_after - item.points_before;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '14px 0',
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      <KnowledgeCircle
        broadCategory={item.broad_category}
        pointsAfter={item.points_after}
        maxPoints={maxPoints}
        animate={visible}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {item.new_territory && (
          <div
            style={{
              fontSize: 8,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.18em',
              color: dc.primary,
              textTransform: 'uppercase',
              marginBottom: 3,
            }}
          >
            New territory
          </div>
        )}
        <div
          style={{
            fontSize: 14,
            fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
            fontWeight: 600,
            color: 'var(--text)',
            lineHeight: 1.25,
            marginBottom: 5,
          }}
        >
          {item.canonical_subcategory}
        </div>
        <div
          style={{
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: tierChanged ? dc.primary : 'var(--text-muted)',
          }}
        >
          {tierChanged
            ? `${item.tier_before} → ${item.tier_after}`
            : tierProgression(item.tier_after)}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div
          style={{
            fontSize: 17,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text)',
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          +{pts}
        </div>
        <div
          style={{
            fontSize: 8,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginTop: 2,
          }}
        >
          pts
        </div>
      </div>
    </div>
  );
}

// ── Round summary row ─────────────────────────────────────────────────────────

function RoundCircleRow({
  item,
  index,
  maxPoints,
  isLast,
}: {
  item: RoundCircleItem;
  index: number;
  maxPoints: number;
  isLast: boolean;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), index * 200);
    return () => clearTimeout(t);
  }, [index]);

  const dc = getPortraitDomainColor(item.broad_category);
  const tierLabel = item.tier_current.charAt(0).toUpperCase() + item.tier_current.slice(1);
  const isMastery = tierLabel === 'Mastery';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '13px 0',
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.35s ease, transform 0.35s ease',
      }}
    >
      <KnowledgeCircle
        broadCategory={item.broad_category}
        pointsAfter={item.points_gained_this_round}
        maxPoints={maxPoints}
        animate={visible}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
            fontWeight: 600,
            color: 'var(--text)',
            lineHeight: 1.25,
            marginBottom: 5,
          }}
        >
          {item.canonical_subcategory}
        </div>
        <div
          style={{
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}
        >
          {isMastery ? 'Mastery' : tierProgression(tierLabel)}
        </div>
        <div
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            marginTop: 4,
          }}
        >
          +{item.points_gained_this_round} this round
        </div>
      </div>
    </div>
  );
}

// ── Section wrappers ──────────────────────────────────────────────────────────

const sectionHeaderStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.2em',
  color: 'var(--text-muted)',
  padding: '0 16px',
  marginTop: 16,
};

const legendStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--text-muted)',
  textAlign: 'center',
  margin: '12px 16px 0',
};

const cardStyle: CSSProperties = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '0 16px',
  margin: '16px 0 0',
};

export function GameCategoryCircles({ items }: { items: GameCircleItem[] }) {
  if (items.length === 0) return null;

  const maxPoints = Math.max(...items.map((i) => i.points_after), 1);

  return (
    <div>
      <p style={sectionHeaderStyle}>See how this shaped your knowledge base</p>
      <div style={cardStyle}>
        {items.map((item, i) => (
          <GameCircleRow
            key={item.canonical_subcategory}
            item={item}
            index={i}
            maxPoints={maxPoints}
            isLast={i === items.length - 1}
          />
        ))}
      </div>
      <p style={legendStyle}>Size = depth of knowledge</p>
    </div>
  );
}

export function RoundCategoryCircles({ items }: { items: RoundCircleItem[] }) {
  if (items.length === 0) return null;

  const maxPoints = Math.max(...items.map((i) => i.points_gained_this_round), 1);

  return (
    <div>
      <p style={sectionHeaderStyle}>See how this shaped your knowledge base</p>
      <div style={cardStyle}>
        {items.map((item, i) => (
          <RoundCircleRow
            key={item.canonical_subcategory}
            item={item}
            index={i}
            maxPoints={maxPoints}
            isLast={i === items.length - 1}
          />
        ))}
      </div>
      <p style={legendStyle}>Size = points this round</p>
    </div>
  );
}
