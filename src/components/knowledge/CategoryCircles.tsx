'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import { KnowledgeBubble } from '@/components/knowledge/KnowledgeBubble';
import { KNOWLEDGE_TIER_LABEL } from '@/server/profile/knowledge-tier-copy';
import { TIER_THRESHOLD_POINTS } from '@/server/mastery/tiers';
import type { MasteryTier } from '@/types/db';

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
  /**
   * The domain's tier at the START of this round, when known (from the
   * server's authoritative tier-crossing record — the same one a same-page
   * "you moved to X" sentence draws from). Omit when no crossing happened
   * this round. Presence gates whether the row shows the TRUE this-round
   * delta or the forward "next milestone" teaser — see `RoundCircleRow`.
   */
  tier_before?: string;
  /** Rank among ALL the player's areas by total points (1 = biggest), when known. */
  area_rank?: number | null;
  /** First time the player has earned points in this area. */
  is_new_territory?: boolean;
};

// Re-export for callers that imported getDomainColor from this module.
export function getDomainColor(broadCategory: string): string {
  return getPortraitDomainColor(broadCategory).primary;
}

// ── Circle sizing — matches PortraitCircles constants ─────────────────────────

// Exported so the knowledge circle-grid view (KnowledgePeaksView) draws its
// planets on the exact same point→diameter / point→opacity scale as the
// game/round summary circles — one sizing language across the surfaces.
export const MIN_SIZE = 30;
export const MAX_SIZE = 72;
const MIN_OPACITY = 0.22;
const SEED = 0.08;
const DURATION = 800;

export function getCircleSize(pts: number, maxPts: number): number {
  const n = pts / Math.max(maxPts, 1);
  return Math.round(MIN_SIZE + n * (MAX_SIZE - MIN_SIZE));
}

export function getCircleOpacity(pts: number, maxPts: number): number {
  const n = pts / Math.max(maxPts, 1);
  return MIN_OPACITY + n * (1 - MIN_OPACITY);
}

// ── Tier helpers ──────────────────────────────────────────────────────────────

const TIER_ORDER: MasteryTier[] = ['establishing', 'familiar', 'solid', 'mastery'];

function tierKey(raw: string): MasteryTier | null {
  const lower = raw.trim().toLowerCase();
  return (TIER_ORDER as readonly string[]).includes(lower) ? (lower as MasteryTier) : null;
}

function displayTier(raw: string): string {
  const key = tierKey(raw);
  return key ? KNOWLEDGE_TIER_LABEL[key] : raw;
}

// Forward-looking "what's next" teaser for a domain that did NOT cross a
// tier boundary this round/game. Deliberately does not use the "X → Y" arrow
// form — that form is reserved for a REAL before/after delta (see
// `tierChanged` below), so this can never be misread as a completed move.
function tierProgression(rawTier: string): string {
  const key = tierKey(rawTier);
  if (!key) return rawTier;
  const idx = TIER_ORDER.indexOf(key);
  const next = TIER_ORDER[idx + 1];
  return next ? `Next: ${KNOWLEDGE_TIER_LABEL[next]}` : KNOWLEDGE_TIER_LABEL.mastery;
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
      setOpacity(
        Math.max(
          MIN_OPACITY,
          Math.min(
            1,
            MIN_OPACITY + (finalOpacity - MIN_OPACITY) * Math.max(0, Math.min(1.2, eased)),
          ),
        ),
      );
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
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
    return () => {
      if (scaleRafRef.current !== null) cancelAnimationFrame(scaleRafRef.current);
    };
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
      <KnowledgeBubble
        diameter={displaySize}
        tint={dc.primary}
        opacity={opacity}
        style={{ transition: animate ? undefined : 'none' }}
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
            fontFamily: 'var(--font-serif), ui-serif, Georgia, serif',
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
            ? `${displayTier(item.tier_before)} → ${displayTier(item.tier_after)}`
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
//
// The round recap shows how BIG each area is, not just what today added: the
// circle is sized by the area's total points, and a solid outer ring is the
// slice today added (thin ring on a big circle = "already huge, grew a bit").
// Under the name, a bar shows how close the area is to its next level, with
// today's piece drawn solid. (Before this, the circle was sized by this-round
// points only, so a huge area and a brand-new one with the same +50 looked
// identical.)

const RING_MIN_R = 15;
const RING_MAX_R = MAX_SIZE / 2;
const RING_MIN_BAND = 2;

// Area-true radius: a circle with 4× the points has 4× the ink, so big areas
// read as big without shrinking the small ones to dots.
function ringRadius(points: number, maxTotal: number): number {
  const n = Math.max(0, points) / Math.max(maxTotal, 1);
  return RING_MIN_R + (RING_MAX_R - RING_MIN_R) * Math.sqrt(Math.min(1, n));
}

function GrowthRingCircle({
  color,
  total,
  gained,
  maxTotal,
  animate,
}: {
  color: string;
  total: number;
  gained: number;
  maxTotal: number;
  animate: boolean;
}) {
  const outer = ringRadius(total, maxTotal);
  // Nothing before today (a brand-new area): the whole circle is today's ring.
  const inner = total - gained > 0 ? ringRadius(total - gained, maxTotal) : 0;
  const band = Math.min(Math.max(outer - inner, RING_MIN_BAND), outer * 0.6);
  return (
    <div
      style={{
        width: MAX_SIZE,
        height: MAX_SIZE,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <KnowledgeBubble
        diameter={Math.round(outer * 2)}
        tint={color}
        border={`${band.toFixed(1)}px solid ${color}`}
        style={{
          transform: animate ? 'scale(1)' : `scale(${SEED})`,
          transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      />
    </div>
  );
}

type LevelProgress = {
  /** 0–100: where the area sits within its current level now. */
  pct: number;
  /** 0–100: where it sat before this round (0 if it crossed a level today). */
  beforePct: number;
  /** The next level's label, or null at Mastery. */
  next: string | null;
};

function levelProgress(total: number, gained: number, rawTier: string): LevelProgress {
  const key = tierKey(rawTier);
  const idx = key ? TIER_ORDER.indexOf(key) : -1;
  const nextKey = idx >= 0 ? TIER_ORDER[idx + 1] : undefined;
  if (!key || !nextKey) return { pct: 100, beforePct: 100, next: null };
  const floor = TIER_THRESHOLD_POINTS[key];
  const span = Math.max(TIER_THRESHOLD_POINTS[nextKey] - floor, 1);
  const toPct = (pts: number) => Math.max(0, Math.min(100, ((pts - floor) / span) * 100));
  // Points can sit past the next threshold when a level has an extra gate
  // (Mastery's creator-share rule) — never claim 100% toward a level not reached.
  const pct = Math.min(99, toPct(total));
  return {
    pct,
    beforePct: Math.min(pct, toPct(total - gained)),
    next: KNOWLEDGE_TIER_LABEL[nextKey],
  };
}

function areaSizeLine(item: RoundCircleItem): string {
  const pts = `${Math.round(item.points_total).toLocaleString('en-US')} pts`;
  if (item.is_new_territory) return `New area · ${pts}`;
  if (item.area_rank && item.area_rank <= 10) return `Your #${item.area_rank} area · ${pts}`;
  return `${pts} total`;
}

const rowMetaStyle: CSSProperties = {
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontVariantNumeric: 'tabular-nums',
};

function RoundCircleRow({
  item,
  index,
  maxTotal,
  isLast,
}: {
  item: RoundCircleItem;
  index: number;
  maxTotal: number;
  isLast: boolean;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), index * 200);
    return () => clearTimeout(t);
  }, [index]);

  // A REAL this-round crossing, from the same server-computed record the
  // page's "you moved to X" sentence draws from — not a forward guess. Only
  // this form ever uses the "X → Y" arrow, so the arrow never appears unless a
  // crossing actually happened (Priority 6 / Screen 13).
  const tierChanged = Boolean(item.tier_before) && item.tier_before !== item.tier_current;
  const dc = getPortraitDomainColor(item.broad_category);
  const gained = item.points_gained_this_round;
  const progress = levelProgress(item.points_total, gained, item.tier_current);

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
      <GrowthRingCircle
        color={dc.primary}
        total={item.points_total}
        gained={gained}
        maxTotal={maxTotal}
        animate={visible}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontFamily: 'var(--font-serif), ui-serif, Georgia, serif',
            fontWeight: 600,
            color: 'var(--text)',
            lineHeight: 1.25,
            marginBottom: 4,
          }}
        >
          {item.canonical_subcategory}
        </div>
        <div style={{ ...rowMetaStyle, color: 'var(--text)' }}>{areaSizeLine(item)}</div>
        <div
          aria-hidden
          style={{
            position: 'relative',
            height: 5,
            borderRadius: 3,
            marginTop: 8,
            overflow: 'hidden',
            background: `color-mix(in srgb, ${dc.primary} 12%, transparent)`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: `${progress.beforePct}%`,
              background: `color-mix(in srgb, ${dc.primary} 38%, transparent)`,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${progress.beforePct}%`,
              width: `${Math.max(progress.pct - progress.beforePct, gained > 0 && progress.next ? 1.5 : 0)}%`,
              background: dc.primary,
            }}
          />
        </div>
        <div
          style={{
            ...rowMetaStyle,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            marginTop: 5,
          }}
        >
          <span style={{ color: tierChanged ? dc.primary : undefined }}>
            {tierChanged
              ? `${displayTier(item.tier_before as string)} → ${displayTier(item.tier_current)}`
              : progress.next
                ? `${Math.floor(progress.pct)}% to ${progress.next}`
                : KNOWLEDGE_TIER_LABEL.mastery}
          </span>
          <span style={{ color: 'var(--text)', flexShrink: 0 }}>+{gained} today</span>
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

  // Biggest area first, so the recap leads with what the player knows most.
  const sorted = [...items].sort(
    (a, b) =>
      b.points_total - a.points_total ||
      b.points_gained_this_round - a.points_gained_this_round ||
      a.canonical_subcategory.localeCompare(b.canonical_subcategory),
  );
  const maxTotal = Math.max(...sorted.map((i) => i.points_total), 1);

  return (
    <div>
      <p style={sectionHeaderStyle}>See how this shaped your knowledge base</p>
      <div style={cardStyle}>
        {sorted.map((item, i) => (
          <RoundCircleRow
            key={item.canonical_subcategory}
            item={item}
            index={i}
            maxTotal={maxTotal}
            isLast={i === sorted.length - 1}
          />
        ))}
      </div>
      <p style={legendStyle}>Size = all you know · Ring = today</p>
    </div>
  );
}
