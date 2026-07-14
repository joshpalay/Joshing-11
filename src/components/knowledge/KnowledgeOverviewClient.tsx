'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard';
import { PortraitCircles, type PortraitEntry } from '@/components/knowledge/PortraitCircles';
import { SharePortraitModal } from '@/components/knowledge/SharePortraitModal';
import type { KnowledgeOverview } from '@/server/profile/knowledge-types';
import { toCanonicalDomainSlug } from '@/server/profile/domain-slug';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';

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

export function KnowledgeOverviewClient({
  overview,
  highlightedDomainSlug,
  tierCrossed,
}: KnowledgeOverviewClientProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(highlightedDomainSlug ?? null);
  const [knowledgeCard, setKnowledgeCard] = useState<KnowledgeCardApi | null>(null);
  const [portraitEntries, setPortraitEntries] = useState<PortraitEntry[]>([]);
  const [portraitError, setPortraitError] = useState(false);
  const [portraitLoaded, setPortraitLoaded] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const portraitFetchedRef = useRef(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const domainNameBySlug = useMemo(
    () => new Map(overview.allDomains.map((domain) => [toCanonicalDomainSlug(domain.name), domain.name])),
    [overview.allDomains],
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

  // Fetch portrait + mastery data
  useEffect(() => {
    if (portraitFetchedRef.current) return;
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
        broadCategory: normalizeBroadCategory(cat.broad_category) ?? 'General Knowledge',
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
  }, [overview.userId]);

  // Deep-link highlight handler
  useEffect(() => {
    if (!highlightedDomainSlug) return;

    const portraitEl = document.getElementById('portrait-circles-section');
    if (portraitEl) portraitEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('domain');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      setActiveSlug(null);
    }, 900);

    return () => window.clearTimeout(timer);
  }, [highlightedDomainSlug]);

  const hasAnything = overview.allDomains.length > 0 || overview.excludedDomains.length > 0 || portraitEntries.length > 0;

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
          <Link href="/knowledge" className="text-[var(--text-muted)] underline underline-offset-2">
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

      {/* Section header + portrait circles (only if player has any knowledge) */}
      {hasAnything && (
        <section style={sectionStyle} aria-label="Knowledge progression">
          {/* Section header */}
          <div style={knowledgeSectionHeaderStyle}>
            <p style={knowledgeEyebrowStyle}>YOUR KNOWLEDGE</p>
            <p style={knowledgeSubtitleStyle}>SEE HOW YOUR KNOWLEDGE IS BUILDING →</p>
          </div>

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
        </section>
      )}

      {/* Share Portrait Modal */}
      {shareModalOpen && knowledgeCard && (
        <SharePortraitModal
          playerDisplayName={knowledgeCard.player_display_name || overview.displayName}
          portraitStatement={knowledgeCard.portrait_statement}
          domains={knowledgeCard.domains.map((d) => ({
            canonicalSubcategory: d.canonical_subcategory,
            currentTier: d.current_tier,
            lifetimePoints: d.lifetime_points,
            iconKey: d.icon_key,
          }))}
          overflowCount={knowledgeCard.overflow_count}
          tierSignature={knowledgeCard.tier_signature}
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
  background: 'var(--brand-field)',
  border: '1px solid var(--warm-border-soft)',
  padding: '1rem 0.95rem',
};

const sectionStyle: CSSProperties = {
  background: 'var(--brand-field)',
  border: '1px solid var(--warm-border-soft)',
  padding: '1rem 0.95rem',
};

const tierCrossedBannerStyle: CSSProperties = {
  background: 'var(--brand-cream)',
  color: 'var(--warm-ink)',
  padding: '0.75rem 0.95rem',
  fontSize: 16,
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
  color: 'var(--warm-ink)',
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
  color: 'var(--warm-ink)',
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  letterSpacing: '0.06em',
};

const knowledgeSubtitleStyle: CSSProperties = {
  margin: '0.15rem 0 0',
  fontSize: 10,
  fontVariant: 'small-caps',
  color: 'var(--warm-ink-400)',
  letterSpacing: '0.06em',
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
};

const emptyStyle: CSSProperties = {
  margin: 0,
  color: 'var(--warm-ink-700)',
};

const sharePortraitWrapStyle: CSSProperties = {
  marginTop: '1.25rem',
  display: 'flex',
  justifyContent: 'center',
};

const sharePortraitBtnStyle: CSSProperties = {
  padding: '11px 32px',
  border: '1.5px solid var(--warm-ink)',
  backgroundColor: 'var(--warm-ink)',
  color: 'var(--warm-paper)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  // The offset-shadow grey is a known color-drift item owned by
  // B-VISUAL-TOKEN-BUDGET-01 (see globals.css "press register" note), not a
  // shadow snap — left raw here deliberately rather than collapsed onto --warm-ink.
  boxShadow: '2px 2px 0 #3a3a3a',
};
