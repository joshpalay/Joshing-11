'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DomainCard } from '@/components/knowledge/DomainCard';
import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard';
import { PortraitCircles, type PortraitEntry } from '@/components/knowledge/PortraitCircles';
import { SharePortraitModal } from '@/components/knowledge/SharePortraitModal';
import type { KnowledgeDomain, KnowledgeOverview } from '@/server/profile/knowledge-types';
import { toCanonicalDomainSlug } from '@/server/profile/domain-slug';

type KnowledgeView = 'classic' | 'progression';
const KNOWLEDGE_VIEW_KEY = 'joshing_knowledge_view';

type KnowledgeOverviewClientProps = {
  overview: KnowledgeOverview;
  highlightedDomainSlug?: string;
  tierCrossed?: string;
};

type KnowledgeCardApi = {
  player_display_name: string;
  portrait_statement: string;
  domains: Array<{
    canonical_subcategory: string;
    canonical_subcategory_slug: string;
    current_tier: 'establishing' | 'familiar' | 'solid' | 'mastery';
    lifetime_points: number;
    icon_key: string;
  }>;
  overflow_count: number;
  tier_signature: string;
  rarest_territory: string | null;
  rarest_territory_solo: boolean;
  share_text: string;
  share_card_token: string;
  share_card_expires_at: string;
};

function readSavedView(): KnowledgeView {
  if (typeof window === 'undefined') return 'progression';
  const raw = localStorage.getItem(KNOWLEDGE_VIEW_KEY);
  // Migrate old 'portrait' value to 'classic'
  if (raw === 'portrait') {
    localStorage.setItem(KNOWLEDGE_VIEW_KEY, 'classic');
    return 'classic';
  }
  if (raw === 'classic' || raw === 'progression') return raw;
  return 'progression';
}

export function KnowledgeOverviewClient({
  overview,
  highlightedDomainSlug,
  tierCrossed,
}: KnowledgeOverviewClientProps) {
  const [view, setView] = useState<KnowledgeView>(readSavedView);
  const [activeSlug, setActiveSlug] = useState<string | null>(highlightedDomainSlug ?? null);
  const [isFading, setIsFading] = useState(false);
  const [activeDomains, setActiveDomains] = useState<KnowledgeDomain[]>(() => overview.allDomains);
  const [excludedDomains, setExcludedDomains] = useState<KnowledgeDomain[]>(() => overview.excludedDomains);
  const [excludedExpanded, setExcludedExpanded] = useState(false);
  const [restoringDomain, setRestoringDomain] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [knowledgeCard, setKnowledgeCard] = useState<KnowledgeCardApi | null>(null);
  const [portraitEntries, setPortraitEntries] = useState<PortraitEntry[]>([]);
  const [portraitError, setPortraitError] = useState(false);
  const [portraitLoaded, setPortraitLoaded] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const portraitFetchedRef = useRef(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const domainNameBySlug = useMemo(
    () => new Map(activeDomains.map((domain) => [toCanonicalDomainSlug(domain.name), domain.name])),
    [activeDomains],
  );

  const highlightedDomainInGraph = useMemo(
    () => activeDomains.slice(0, overview.topDomains.length).some((domain) => toCanonicalDomainSlug(domain.name) === activeSlug),
    [activeDomains, overview.topDomains.length, activeSlug],
  );

  // Clean up ?tier_crossed= param
  useEffect(() => {
    if (!tierCrossed) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('tier_crossed');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [tierCrossed]);

  // Fetch Knowledge Card data
  useEffect(() => {
    fetch(`/api/users/${overview.userId}/knowledge-card`).then(async (res) => {
      if (!res.ok) return;
      const json = await res.json() as KnowledgeCardApi;
      setKnowledgeCard(json);
    }).catch(() => undefined);
  }, [overview.userId]);

  // Fetch portrait + mastery data (lazy — only when view becomes 'progression')
  useEffect(() => {
    if (view !== 'progression' || portraitFetchedRef.current) return;
    portraitFetchedRef.current = true;
    Promise.all([
      fetch(`/api/users/${overview.userId}/portrait`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/users/${overview.userId}/mastery`).then((r) => r.ok ? r.json() : null),
    ]).then(([portraitData, masteryData]: [unknown, unknown]) => {
      if (!portraitData || typeof portraitData !== 'object' || !('categories' in portraitData)) {
        setPortraitError(true);
        setPortraitLoaded(true);
        return;
      }
      const masteryMap = new Map<string, string>(
        ((masteryData as { mastery?: Array<{ canonical_subcategory: string; current_tier: string }> })?.mastery ?? [])
          .map((m) => [m.canonical_subcategory, m.current_tier]),
      );
      const entries: PortraitEntry[] = (
        (portraitData as { categories: Array<{ canonical_subcategory: string; broad_category: string; declared_score: number; proven_score: number; authored_answered_count: number }> }).categories
      ).map((cat) => ({
        canonicalSubcategory: cat.canonical_subcategory,
        broadCategory: cat.broad_category,
        totalMasteryPoints: (cat.declared_score ?? 0) + (cat.proven_score ?? 0),
        tier: (masteryMap.get(cat.canonical_subcategory) ?? 'establishing') as PortraitEntry['tier'],
        authoredAnsweredCount: cat.authored_answered_count ?? 0,
      }));
      setPortraitEntries(entries);
      setPortraitLoaded(true);
    }).catch(() => {
      setPortraitError(true);
      setPortraitLoaded(true);
    });
  }, [view, overview.userId]);

  // Deep-link highlight handler
  useEffect(() => {
    if (!highlightedDomainSlug) return;

    if (view === 'progression') {
      const portraitEl = document.getElementById('portrait-circles-section');
      if (portraitEl) portraitEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Classic view: scroll to the domain row
      const element = document.getElementById(`knowledge-domain-${highlightedDomainSlug}`);
      if (!highlightedDomainInGraph && element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('domain');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      setActiveSlug(null);
    }, 900);

    return () => window.clearTimeout(timer);
  }, [highlightedDomainSlug, view, highlightedDomainInGraph]);

  const onToggleView = (nextView: KnowledgeView) => {
    if (nextView === view) return;
    setIsFading(true);
    window.setTimeout(() => {
      setView(nextView);
      localStorage.setItem(KNOWLEDGE_VIEW_KEY, nextView);
      setIsFading(false);
      if (portraitError) {
        setPortraitError(false);
        setPortraitLoaded(false);
        portraitFetchedRef.current = false;
      }
    }, 150);
  };

  const handleExclude = (domain: KnowledgeDomain) => {
    setActiveDomains((prev) => prev.filter((d) => d.name !== domain.name));
    setExcludedDomains((prev) => [domain, ...prev]);
    void fetch('/api/users/domain-exclusions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonical_subcategory: domain.name }),
    });
  };

  const handleRestore = async (domain: KnowledgeDomain) => {
    setRestoringDomain(domain.name);
    try {
      const res = await fetch(`/api/users/domain-exclusions/${encodeURIComponent(domain.name)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setExcludedDomains((prev) => prev.filter((d) => d.name !== domain.name));
        setActiveDomains((prev) => {
          const next = [...prev, domain];
          next.sort((a, b) => {
            if (b.masteryPoints !== a.masteryPoints) return b.masteryPoints - a.masteryPoints;
            const aW = a.declaredQuestionCount + a.provenCorrectCount;
            const bW = b.declaredQuestionCount + b.provenCorrectCount;
            if (bW !== aW) return bW - aW;
            return a.name.localeCompare(b.name);
          });
          return next;
        });
      }
    } finally {
      setRestoringDomain(null);
    }
  };

  const hasAnything = activeDomains.length > 0 || excludedDomains.length > 0 || portraitEntries.length > 0;

  return (
    <main style={mainStyle}>
      {/* Tier-crossed banner */}
      {tierCrossed && highlightedDomainSlug && (
        <section style={tierCrossedBannerStyle}>
          You reached {capitalize(tierCrossed)} in {domainNameBySlug.get(highlightedDomainSlug) ?? 'this domain'} this session.
        </section>
      )}

      {/* Portrait header — always visible */}
      <section style={headerSectionStyle} aria-label="Your Mind">
        <p style={eyebrowStyle}>Your Mind</p>
        <h1 style={sentenceStyle}>{overview.yourMind}</h1>
        <p style={{ margin: '10px 0 0', fontSize: '0.82rem' }}>
          <Link href="/daily/setup" className="text-[var(--text-muted)] underline underline-offset-2">
            Personal Daily
          </Link>
        </p>
      </section>

      {/* Knowledge Card — always visible when loaded */}
      {knowledgeCard && (
        <section ref={cardRef} style={sectionStyle} aria-label="Knowledge card">
          <KnowledgeCard
            playerDisplayName={knowledgeCard.player_display_name}
            portraitStatement={knowledgeCard.portrait_statement}
            domains={knowledgeCard.domains.map((d) => ({
              canonicalSubcategory: d.canonical_subcategory,
              canonicalSubcategorySlug: d.canonical_subcategory_slug,
              currentTier: d.current_tier,
              lifetimePoints: d.lifetime_points,
              iconKey: d.icon_key,
            }))}
            overflowCount={knowledgeCard.overflow_count}
            tierSignature={knowledgeCard.tier_signature}
            rarestTerritory={knowledgeCard.rarest_territory}
            rarestTerritorySolo={knowledgeCard.rarest_territory_solo}
            shareText={knowledgeCard.share_text}
            shareCardToken={knowledgeCard.share_card_token}
            shareCardExpiresAt={knowledgeCard.share_card_expires_at}
            highlightedSlug={activeSlug}
          />
        </section>
      )}

      {/* Section header + toggle + domain list (only if player has any knowledge) */}
      {hasAnything && (
        <section style={sectionStyle} aria-label="Knowledge progression">
          {/* Section header */}
          <div style={knowledgeSectionHeaderStyle}>
            <p style={knowledgeEyebrowStyle}>YOUR KNOWLEDGE</p>
            <p style={knowledgeSubtitleStyle}>SEE HOW YOUR KNOWLEDGE IS BUILDING →</p>
          </div>

          {/* Toggle */}
          <div style={toggleRowStyle} aria-label="Knowledge view toggle">
            <div style={toggleWrapStyle}>
              <button
                type="button"
                onClick={() => onToggleView('classic')}
                style={view === 'classic' ? activeToggleStyle : inactiveToggleStyle}
                aria-pressed={view === 'classic'}
              >
                Classic
              </button>
              <button
                type="button"
                onClick={() => onToggleView('progression')}
                style={view === 'progression' ? activeToggleStyle : inactiveToggleStyle}
                aria-pressed={view === 'progression'}
              >
                Progression
              </button>
            </div>
            {view === 'classic' && (
              <button
                type="button"
                onClick={() => setEditMode((v) => !v)}
                style={manageButtonStyle}
              >
                {editMode ? 'Done' : 'Manage'}
              </button>
            )}
          </div>

          {/* Domain list — fades between views */}
          <div style={{ ...contentShellStyle, opacity: isFading ? 0 : 1 }}>
            {view === 'classic' ? (
              <div style={cardStackStyle}>
                {activeDomains.map((domain) => (
                  <div key={domain.name} id={`knowledge-domain-${toCanonicalDomainSlug(domain.name)}`}>
                    <DomainCard
                      domain={domain}
                      highlighted={activeSlug === toCanonicalDomainSlug(domain.name)}
                      trailingControl={editMode ? (
                        <button
                          type="button"
                          onClick={() => handleExclude(domain)}
                          style={excludeButtonStyle}
                          aria-label={`Remove ${domain.name} from rotation`}
                        >
                          ✕
                        </button>
                      ) : undefined}
                    />
                  </div>
                ))}
                {activeDomains.length === 0 && excludedDomains.length === 0 && (
                  <p style={emptyStyle}>Play a round and your domains will start to appear here.</p>
                )}
                {excludedDomains.length > 0 && (
                  <div style={excludedSectionStyle}>
                    <button
                      type="button"
                      onClick={() => setExcludedExpanded((v) => !v)}
                      style={excludedHeaderStyle}
                      aria-expanded={excludedExpanded}
                    >
                      <span>{excludedDomains.length} excluded topic{excludedDomains.length !== 1 ? 's' : ''}</span>
                      <span style={excludedChevronStyle} aria-hidden>{excludedExpanded ? '▲' : '▼'}</span>
                    </button>
                    {excludedExpanded && (
                      <div style={excludedListStyle}>
                        {excludedDomains.map((domain) => (
                          <div key={domain.name} style={excludedItemStyle}>
                            <span style={excludedDomainNameStyle}>{domain.name}</span>
                            <button
                              type="button"
                              disabled={restoringDomain === domain.name}
                              onClick={() => { void handleRestore(domain); }}
                              style={restoreLinkStyle}
                            >
                              {restoringDomain === domain.name ? 'Restoring…' : 'Restore'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div id="portrait-circles-section">
                {portraitError ? (
                  <p style={emptyStyle}>Could not load your portrait data. Try refreshing.</p>
                ) : portraitEntries.length === 0 && portraitLoaded ? (
                  <p style={emptyStyle}>Play a round and your portrait will start to appear here.</p>
                ) : portraitEntries.length > 0 ? (
                  <>
                    <PortraitCircles entries={portraitEntries} />
                    <div style={sharePortraitWrapStyle}>
                      <button
                        type="button"
                        style={sharePortraitBtnStyle}
                        onClick={() => setShareModalOpen(true)}
                      >
                        Share portrait
                      </button>
                    </div>
                  </>
                ) : (
                  <p style={emptyStyle}>Loading…</p>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Share Portrait Modal */}
      {shareModalOpen && (
        <SharePortraitModal
          entries={portraitEntries}
          playerDisplayName={overview.displayName}
          onClose={() => setShareModalOpen(false)}
        />
      )}
    </main>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const mainStyle: CSSProperties = {
  width: 'min(760px, 94vw)',
  margin: '0 auto',
  padding: '1.25rem 0 2.5rem',
  display: 'grid',
  gap: '0.9rem',
};

const headerSectionStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #ddd6c7',
  padding: '1rem 0.95rem',
};

const sectionStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #ddd6c7',
  padding: '1rem 0.95rem',
};

const tierCrossedBannerStyle: CSSProperties = {
  background: '#f0e6c8',
  color: '#1a1208',
  padding: '0.75rem 0.95rem',
  fontSize: 16,
};

const toggleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  margin: '0.75rem 0',
};

const toggleWrapStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
};

const activeToggleStyle: CSSProperties = {
  minHeight: 34,
  padding: '0 14px',
  borderRadius: 999,
  border: 'none',
  background: '#1a1208',
  color: '#f5f0e8',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 14,
};

const inactiveToggleStyle: CSSProperties = {
  minHeight: 34,
  padding: '0 12px',
  borderRadius: 999,
  border: 'none',
  background: 'transparent',
  color: '#8a8070',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 14,
};

const contentShellStyle: CSSProperties = {
  transition: 'opacity 150ms ease',
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-muted)',
};

const sentenceStyle: CSSProperties = {
  margin: '0.35rem 0 0',
  fontSize: 'clamp(1.1rem, 2.5vw, 1.55rem)',
  lineHeight: 1.35,
  color: '#111111',
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontWeight: 600,
};

const knowledgeSectionHeaderStyle: CSSProperties = {
  marginBottom: '0.5rem',
};

const knowledgeEyebrowStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontVariant: 'small-caps',
  color: '#1a1208',
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  letterSpacing: '0.06em',
};

const knowledgeSubtitleStyle: CSSProperties = {
  margin: '0.15rem 0 0',
  fontSize: 10,
  fontVariant: 'small-caps',
  color: '#8a8070',
  letterSpacing: '0.06em',
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
};

const cardStackStyle: CSSProperties = {
  display: 'grid',
  gap: '0.6rem',
};

const emptyStyle: CSSProperties = {
  margin: 0,
  color: '#696257',
};

const sharePortraitWrapStyle: CSSProperties = {
  marginTop: '1.25rem',
  display: 'flex',
  justifyContent: 'center',
};

const sharePortraitBtnStyle: CSSProperties = {
  padding: '11px 32px',
  border: '1.5px solid #0e0e0e',
  backgroundColor: '#0e0e0e',
  color: '#faf8f2',
  fontFamily: "'Courier New', monospace",
  fontSize: 12,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  boxShadow: '2px 2px 0 #3a3a3a',
};

const excludedSectionStyle: CSSProperties = {
  marginTop: '0.25rem',
};

const excludedHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  background: 'none',
  border: 'none',
  padding: '0.6rem 0.2rem',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  fontSize: '0.82rem',
  fontFamily: 'inherit',
  textAlign: 'left',
};

const excludedChevronStyle: CSSProperties = {
  fontSize: '0.65rem',
  color: 'var(--text-muted)',
};

const excludedListStyle: CSSProperties = {
  display: 'grid',
  gap: '0.1rem',
  paddingBottom: '0.25rem',
};

const excludedItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.55rem 0.2rem',
  borderTop: '1px solid var(--border)',
};

const excludedDomainNameStyle: CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.92rem',
};

const restoreLinkStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: 'var(--text-muted)',
  fontSize: '0.76rem',
  textDecoration: 'underline',
  fontFamily: 'inherit',
};

const manageButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: 'var(--text-muted)',
  fontSize: '0.76rem',
  fontFamily: 'var(--font-mono)',
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
};

const excludeButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '0 0.2rem',
  cursor: 'pointer',
  color: '#9a8e82',
  fontSize: '1rem',
  lineHeight: 1,
};
