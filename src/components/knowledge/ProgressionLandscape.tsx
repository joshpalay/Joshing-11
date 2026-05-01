'use client';

import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { DomainCircle } from '@/components/knowledge/DomainCircle';

// ─── Constants ────────────────────────────────────────────────────────────────

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


function getIsMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
}

function consumeScrollHint(): boolean {
  if (!getIsMobileViewport()) return false;
  try {
    const count = parseInt(localStorage.getItem(SCROLL_HINT_KEY) ?? '0', 10);
    const shouldShow = count < 3;
    if (shouldShow) {
      localStorage.setItem(SCROLL_HINT_KEY, String(count + 1));
    }
    return shouldShow;
  } catch {
    return false;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProgressionDomain {
  canonicalSubcategory: string;
  canonicalSubcategorySlug: string;
  broadCategory: string | null;
  currentTier: Tier | null;
  correctAnswerCount: number;
  authoredCount: number;
  iconKey: string;
}

interface ProgressionLandscapeProps {
  domains: ProgressionDomain[];
  maxCorrectAnswerCount: number;
  highlightSlug: string | null;
}

// ─── Circle sizing ────────────────────────────────────────────────────────────

function getCircleDiameter(
  correctAnswerCount: number,
  maxCorrectAnswerCount: number,
  isMobile: boolean,
): number {
  const MAX = isMobile ? MAX_CIRCLE_DIAMETER_MOBILE : MAX_CIRCLE_DIAMETER;
  const MIN = isMobile ? MIN_CIRCLE_DIAMETER_MOBILE : MIN_CIRCLE_DIAMETER;
  const GHOST = isMobile ? GHOST_CIRCLE_DIAMETER_MOBILE : GHOST_CIRCLE_DIAMETER;

  if (correctAnswerCount === 0) return GHOST;

  const safeMax = Math.max(1, maxCorrectAnswerCount);
  const ratio = correctAnswerCount / safeMax;
  return Math.round(MIN + ratio * (MAX - MIN));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProgressionLandscape({
  domains,
  maxCorrectAnswerCount,
  highlightSlug,
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

  // Detect mobile and update one-time mobile scroll hint visibility.
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

  // Restore scroll position (same day only)
  useEffect(() => {
    if (!isMobile || !scrollRef.current) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const savedDate = localStorage.getItem(SCROLL_DATE_KEY);
      if (savedDate === today) {
        const savedX = parseInt(localStorage.getItem(SCROLL_X_KEY) ?? '0', 10);
        scrollRef.current.scrollLeft = savedX;
      }
    } catch {
      // localStorage unavailable
    }
  }, [isMobile]);

  // Save scroll position
  useEffect(() => {
    if (!isMobile) return;
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        localStorage.setItem(SCROLL_X_KEY, String(el.scrollLeft));
        localStorage.setItem(SCROLL_DATE_KEY, today);
      } catch {
        // localStorage unavailable
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [isMobile]);

  // IntersectionObserver for column headers (tier label visibility)
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    for (const tier of TIERS) {
      const el = headerRefs.current[tier];
      if (!el) continue;
      const observer = new IntersectionObserver(
        ([entry]) => {
          setColumnHeadersVisible((prev) => ({
            ...prev,
            [tier]: entry?.isIntersecting ?? true,
          }));
        },
        { threshold: 0.5 },
      );
      observer.observe(el);
      observers.push(observer);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  // Highlight circle from deep-link
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
    const timer = window.setTimeout(() => {
      setExpiredHighlightSlug(highlightSlug);
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [highlightSlug, isMobile]);

  // Handle circle tap (opacity pulse; expand is deferred — §8.37)
  const handleTap = (slug: string) => {
    // TODO: tap-to-expand domain detail card — separate prompt (§8.37)
    const el = document.getElementById(`progression-circle-${slug}`);
    if (!el) return;
    el.style.opacity = '0.7';
    window.setTimeout(() => { el.style.opacity = ''; }, 100);
  };

  // ── Build data structures ──────────────────────────────────────────────────

  // Globally sorted category list (alphabetical, null last)
  const sortedCategories: string[] = [];
  {
    const seen = new Set<string>();
    for (const d of domains) {
      const cat = d.broadCategory ?? '';
      if (!seen.has(cat)) { seen.add(cat); sortedCategories.push(cat); }
    }
    sortedCategories.sort((a, b) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
  }

  // Build lookup: tier → category → domains[]
  const tierCategoryDomains = new Map<Tier, Map<string, ProgressionDomain[]>>();
  for (const tier of TIERS) {
    tierCategoryDomains.set(tier, new Map());
  }

  for (const domain of domains) {
    const tier = domain.currentTier ?? 'establishing';
    const isGhost = domain.correctAnswerCount === 0;

    // Ghost circles only appear in Establishing
    if (isGhost && tier !== 'establishing') continue;

    const cat = domain.broadCategory ?? '';
    const map = tierCategoryDomains.get(isGhost ? 'establishing' : tier)!;
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(domain);
  }

  // Sort domains within each cell: largest first, ghosts last
  for (const catMap of tierCategoryDomains.values()) {
    for (const [cat, list] of catMap) {
      list.sort((a, b) => {
        const aGhost = a.correctAnswerCount === 0;
        const bGhost = b.correctAnswerCount === 0;
        if (aGhost !== bGhost) return aGhost ? 1 : -1;
        return b.correctAnswerCount - a.correctAnswerCount;
      });
      catMap.set(cat, list);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile
      ? `repeat(4, ${MOBILE_COL_WIDTH}px)`
      : 'repeat(4, minmax(100px, 1fr))',
    minWidth: isMobile ? `${MOBILE_COL_WIDTH * 4}px` : undefined,
  };

  const containerStyle: CSSProperties = isMobile
    ? {
        overflowX: 'auto',
        overflowY: 'visible',
        WebkitOverflowScrolling: 'touch',
        position: 'relative',
      }
    : {};

  return (
    <div>
      {/* Scroll container (mobile only) */}
      <div ref={scrollRef} style={containerStyle}>
        {/* Right-edge fade on mobile */}
        {isMobile && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: 40,
              background: 'linear-gradient(to right, transparent, #f5f0e8)',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          />
        )}

        <div style={gridStyle}>
          {/* Column headers row */}
          {TIERS.map((tier, i) => (
            <div
              key={tier}
              ref={(el) => { headerRefs.current[tier] = el; }}
              style={{
                ...colHeaderStyle,
                borderRight: i < 3 ? '1px solid #e8e2d6' : undefined,
              }}
            >
              {TIER_LABEL[tier]}
            </div>
          ))}

          {/* Category rows — each category produces 4 cells (one per tier column) */}
          {sortedCategories.map((cat) => (
            <Fragment key={cat}>
              {TIERS.map((tier, colIdx) => {
                const cellDomains = tierCategoryDomains.get(tier)?.get(cat) ?? [];
                return (
                  <div
                    key={`${cat}-${tier}`}
                    style={{
                      ...cellStyle,
                      borderRight: colIdx < 3 ? '1px solid #e8e2d6' : undefined,
                    }}
                  >
                    {/* Category label — always 24px, even if empty */}
                    <div style={categoryLabelStyle}>
                      {colIdx === 0 ? (cat || 'Other') : ''}
                    </div>

                    {/* Circles */}
                    {cellDomains.map((domain) => {
                      const isGhost = domain.correctAnswerCount === 0;
                      const diameter = getCircleDiameter(
                        domain.correctAnswerCount,
                        maxCorrectAnswerCount,
                        isMobile,
                      );
                      const isHighlighted =
                        highlightSlug === domain.canonicalSubcategorySlug
                        && expiredHighlightSlug !== domain.canonicalSubcategorySlug;

                      return (
                        <div
                          key={domain.canonicalSubcategorySlug}
                          style={circleRowStyle}
                        >
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
                            onTap={isGhost ? undefined : () => handleTap(domain.canonicalSubcategorySlug)}
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

      {/* Mobile scroll hint — first 3 visits only */}
      {isMobile && showScrollHint && (
        <p style={scrollHintStyle}>SCROLL TO SEE YOUR FULL PROGRESSION →</p>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
