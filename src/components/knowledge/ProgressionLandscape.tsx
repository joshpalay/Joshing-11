'use client';

import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { DomainCircle } from '@/components/knowledge/DomainCircle';
import type { MasteryTier } from '@/types/db';

const TIERS = ['establishing', 'familiar', 'solid', 'mastery'] as const;
type Tier = (typeof TIERS)[number];

const TIER_LABEL: Record<Tier, string> = {
  establishing: 'ESTABLISHING',
  familiar: 'FAMILIAR',
  solid: 'SOLID',
  mastery: 'MASTERY',
};

const MAX_CIRCLE_DIAMETER = 72;
const MIN_CIRCLE_DIAMETER = 28;
const GHOST_CIRCLE_DIAMETER = 28;
const MAX_CIRCLE_DIAMETER_MOBILE = 60;
const MIN_CIRCLE_DIAMETER_MOBILE = 24;
const GHOST_CIRCLE_DIAMETER_MOBILE = 24;
const MOBILE_BREAKPOINT = 430;
const MOBILE_COL_WIDTH = 160;
const SCROLL_HINT_KEY = 'knowledge_progression_scroll_hint_count';
const SCROLL_X_KEY = 'knowledge_landscape_scroll_x';
const SCROLL_DATE_KEY = 'knowledge_landscape_scroll_date';

export interface ProgressionDomain {
  canonicalSubcategory: string;
  canonicalSubcategorySlug: string;
  broadCategory: string | null;
  currentTier: MasteryTier | null;
  correctAnswerCount: number;
  authoredCount: number;
  iconKey: string;
}

interface ProgressionLandscapeProps {
  domains: ProgressionDomain[];
  maxCorrectAnswerCount: number;
  highlightSlug: string | null;
  onDomainSelect?: (domain: string) => void;
}

function getIsMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
}

function consumeScrollHint(): boolean {
  if (!getIsMobileViewport()) return false;
  try {
    const count = parseInt(localStorage.getItem(SCROLL_HINT_KEY) ?? '0', 10);
    const shouldShow = count < 3;
    if (shouldShow) localStorage.setItem(SCROLL_HINT_KEY, String(count + 1));
    return shouldShow;
  } catch {
    return false;
  }
}

function getCircleDiameter(correctAnswerCount: number, maxCorrectAnswerCount: number, isMobile: boolean): number {
  const max = isMobile ? MAX_CIRCLE_DIAMETER_MOBILE : MAX_CIRCLE_DIAMETER;
  const min = isMobile ? MIN_CIRCLE_DIAMETER_MOBILE : MIN_CIRCLE_DIAMETER;
  const ghost = isMobile ? GHOST_CIRCLE_DIAMETER_MOBILE : GHOST_CIRCLE_DIAMETER;
  if (correctAnswerCount === 0) return ghost;
  return Math.round(min + (correctAnswerCount / Math.max(1, maxCorrectAnswerCount)) * (max - min));
}

export function ProgressionLandscape({
  domains,
  maxCorrectAnswerCount,
  highlightSlug,
  onDomainSelect,
}: ProgressionLandscapeProps) {
  const [isMobile, setIsMobile] = useState(getIsMobileViewport);
  const [showScrollHint, setShowScrollHint] = useState(consumeScrollHint);
  const [columnHeadersVisible, setColumnHeadersVisible] = useState<Record<Tier, boolean>>({
    establishing: true,
    familiar: true,
    solid: true,
    mastery: true,
  });
  const [expiredHighlightSlug, setExpiredHighlightSlug] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRefs = useRef<Record<Tier, HTMLDivElement | null>>({
    establishing: null,
    familiar: null,
    solid: null,
    mastery: null,
  });

  useEffect(() => {
    const onResize = () => {
      const mobile = getIsMobileViewport();
      setIsMobile((prev) => {
        if (prev === mobile) return prev;
        setShowScrollHint(mobile ? consumeScrollHint() : false);
        return mobile;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!isMobile || !scrollRef.current) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem(SCROLL_DATE_KEY) === today) {
        scrollRef.current.scrollLeft = parseInt(localStorage.getItem(SCROLL_X_KEY) ?? '0', 10);
      }
    } catch {
      // localStorage unavailable
    }
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      try {
        localStorage.setItem(SCROLL_X_KEY, String(el.scrollLeft));
        localStorage.setItem(SCROLL_DATE_KEY, new Date().toISOString().slice(0, 10));
      } catch {
        // localStorage unavailable
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [isMobile]);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    for (const tier of TIERS) {
      const el = headerRefs.current[tier];
      if (!el) continue;
      const observer = new IntersectionObserver(
        ([entry]) => {
          setColumnHeadersVisible((prev) => ({ ...prev, [tier]: entry?.isIntersecting ?? true }));
        },
        { threshold: 0.5 },
      );
      observer.observe(el);
      observers.push(observer);
    }
    return () => observers.forEach((observer) => observer.disconnect());
  }, []);

  useEffect(() => {
    if (!highlightSlug) return;
    const circleEl = document.getElementById(`progression-circle-${highlightSlug}`);
    if (circleEl) {
      circleEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (isMobile && scrollRef.current) {
        const rect = circleEl.getBoundingClientRect();
        const containerRect = scrollRef.current.getBoundingClientRect();
        scrollRef.current.scrollLeft += rect.left - containerRect.left - containerRect.width / 2;
      }
    }
    const timer = window.setTimeout(() => setExpiredHighlightSlug(highlightSlug), 700);
    return () => window.clearTimeout(timer);
  }, [highlightSlug, isMobile]);

  const sortedCategories = [...new Set(domains.map((domain) => domain.broadCategory ?? ''))].sort((a, b) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b);
  });

  const tierCategoryDomains = new Map<Tier, Map<string, ProgressionDomain[]>>();
  for (const tier of TIERS) tierCategoryDomains.set(tier, new Map());

  for (const domain of domains) {
    const tier = domain.currentTier ?? 'establishing';
    const isGhost = domain.correctAnswerCount === 0;
    if (isGhost && tier !== 'establishing') continue;
    const category = domain.broadCategory ?? '';
    const map = tierCategoryDomains.get(isGhost ? 'establishing' : tier)!;
    map.set(category, [...(map.get(category) ?? []), domain]);
  }

  for (const catMap of tierCategoryDomains.values()) {
    for (const [category, list] of catMap) {
      catMap.set(category, [...list].sort((a, b) => {
        const aGhost = a.correctAnswerCount === 0;
        const bGhost = b.correctAnswerCount === 0;
        if (aGhost !== bGhost) return aGhost ? 1 : -1;
        return b.correctAnswerCount - a.correctAnswerCount;
      }));
    }
  }

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile ? `repeat(4, ${MOBILE_COL_WIDTH}px)` : 'repeat(4, minmax(100px, 1fr))',
    minWidth: isMobile ? `${MOBILE_COL_WIDTH * 4}px` : undefined,
  };

  const containerStyle: CSSProperties = isMobile
    ? { overflowX: 'auto', overflowY: 'visible', WebkitOverflowScrolling: 'touch', position: 'relative' }
    : {};

  return (
    <div>
      <div ref={scrollRef} style={containerStyle}>
        {isMobile && <div style={mobileFadeStyle} />}
        <div style={gridStyle}>
          {TIERS.map((tier, i) => (
            <div
              key={tier}
              ref={(el) => {
                headerRefs.current[tier] = el;
              }}
              style={{ ...colHeaderStyle, borderRight: i < 3 ? '1px solid #e8e2d6' : undefined }}
            >
              {TIER_LABEL[tier]}
            </div>
          ))}

          {sortedCategories.map((category) => (
            <Fragment key={category}>
              {TIERS.map((tier, colIdx) => {
                const cellDomains = tierCategoryDomains.get(tier)?.get(category) ?? [];
                return (
                  <div key={`${category}-${tier}`} style={{ ...cellStyle, borderRight: colIdx < 3 ? '1px solid #e8e2d6' : undefined }}>
                    <div style={categoryLabelStyle}>{colIdx === 0 ? (category || 'Other') : ''}</div>
                    {cellDomains.map((domain) => {
                      const isGhost = domain.correctAnswerCount === 0;
                      const diameter = getCircleDiameter(domain.correctAnswerCount, maxCorrectAnswerCount, isMobile);
                      const isHighlighted = highlightSlug === domain.canonicalSubcategorySlug && expiredHighlightSlug !== domain.canonicalSubcategorySlug;

                      return (
                        <div key={domain.canonicalSubcategorySlug} style={circleRowStyle}>
                          <DomainCircle
                            id={`progression-circle-${domain.canonicalSubcategorySlug}`}
                            diameter={diameter}
                            iconKey={domain.iconKey}
                            canonicalSubcategory={domain.canonicalSubcategory}
                            currentTier={domain.currentTier}
                            showYourQs={domain.authoredCount}
                            highlighted={isHighlighted}
                            isGhost={isGhost}
                            showTierLabel={!columnHeadersVisible[tier]}
                            onTap={isGhost ? undefined : () => onDomainSelect?.(domain.canonicalSubcategory)}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      {isMobile && showScrollHint && <p style={scrollHintStyle}>SCROLL TO SEE YOUR FULL PROGRESSION -&gt;</p>}
    </div>
  );
}

const mobileFadeStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: 40,
  background: 'linear-gradient(to right, transparent, #f5f0e8)',
  pointerEvents: 'none',
  zIndex: 2,
};

const colHeaderStyle: CSSProperties = {
  fontSize: 10,
  fontVariant: 'small-caps',
  color: '#8a8070',
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  textAlign: 'center',
  padding: '8px 4px 6px',
  letterSpacing: '0.06em',
};

const cellStyle: CSSProperties = {
  padding: '0 4px 12px',
  verticalAlign: 'top',
};

const categoryLabelStyle: CSSProperties = {
  height: 24,
  display: 'flex',
  alignItems: 'center',
  fontSize: 9,
  fontVariant: 'small-caps',
  color: '#8a8070',
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  letterSpacing: '0.06em',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const circleRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  marginTop: 8,
};

const scrollHintStyle: CSSProperties = {
  marginTop: 10,
  fontSize: 10,
  color: '#8a8070',
  fontVariant: 'small-caps',
  letterSpacing: '0.06em',
  textAlign: 'center',
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
};
