'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { Combine, Plus, Repeat2, X } from 'lucide-react';
import { QuestionForm, type QuestionFormValues } from '@/components/QuestionForm';

import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard';
import { PortraitCircles, type PortraitEntry } from '@/components/knowledge/PortraitCircles';
import { SharePortraitModal } from '@/components/knowledge/SharePortraitModal';
import { toCanonicalDomainSlug } from '@/server/profile/domain-slug';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';
import type { MasteryTier } from '@/types/db';

type DomainMastery = {
  domain: string;
  displayName: string;
  points: number;
  tier: string;
  tierProgress: number;
  questionsAnswered: number;
  questionsCorrect: number;
  correctRate: number;
  lastActivityAt: string | null;
  broadCategory: string | null;
  iconKey: string;
  isDeclared: boolean;
  isDeclaredInterest: boolean;
  isDemonstrated: boolean;
  territoryType?: 'declared' | 'demonstrated';
};

type KnowledgeResponse = {
  mastery: {
    totalPoints: number;
    domains: DomainMastery[];
  };
  pageData: {
    allDomains: DomainMastery[];
    declaredInterests: string[];
  };
};

type InterestModalState = {
  slotIndex: number;
  currentDomain: string | null;
};

type ProposedInterest = {
  label: string;
  description?: string | null;
  broadCategory?: string | null;
};

type TidyResult = {
  mergesApplied: number;
  domainsBefore: number;
  domainsAfter: number;
  details: Array<{ sources: string[]; target: string; rationale: string }>;
};

function asTier(value: string): MasteryTier {
  if (value === 'familiar' || value === 'solid' || value === 'mastery') return value;
  return 'establishing';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function domainKey(value: string): string {
  return value.trim().toLowerCase();
}

function displayMind(domains: DomainMastery[], declaredInterests: string[]): string {
  const top = domains.filter((domain) => domain.points > 0).slice(0, 3).map((domain) => domain.displayName);
  if (top.length >= 2) return `A mind that is building around ${top.slice(0, -1).join(', ')} and ${top.at(-1)}.`;
  if (top.length === 1) return `A mind that is building around ${top[0]}.`;
  if (declaredInterests.length > 0) return `Your mind is ready to explore ${declaredInterests.slice(0, 3).join(', ')}.`;
  return 'Your mind will take shape as you play and write questions.';
}

function toPortraitEntry(domain: DomainMastery): PortraitEntry {
  return {
    canonicalSubcategory: domain.displayName,
    broadCategory: normalizeBroadCategory(domain.broadCategory) ?? 'Other',
    totalMasteryPoints: Math.max(domain.points, domain.isDeclaredInterest ? 1 : 0),
    tier: asTier(domain.tier),
    authoredAnsweredCount: domain.questionsAnswered,
  };
}

function emptyDomain(domain: string): DomainMastery {
  return {
    domain,
    displayName: domain,
    points: 0,
    tier: 'establishing',
    tierProgress: 0,
    questionsAnswered: 0,
    questionsCorrect: 0,
    correctRate: 0,
    lastActivityAt: null,
    broadCategory: null,
    iconKey: toCanonicalDomainSlug(domain),
    isDeclared: true,
    isDeclaredInterest: true,
    isDemonstrated: false,
  };
}

function LoadingSkeleton() {
  return (
    <main style={mainStyle}>
      <section style={sectionStyle}>
        <p style={emptyStyle}>Loading...</p>
      </section>
    </main>
  );
}

export default function KnowledgePage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <KnowledgePageContent />
    </Suspense>
  );
}

function KnowledgePageContent() {
  const searchParams = useSearchParams();
  const highlightedDomainSlug = searchParams.get('domain');
  const tierCrossed = searchParams.get('tier_crossed');
  const manageInterestsParam = searchParams.get('interests');

  const [data, setData] = useState<KnowledgeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(highlightedDomainSlug);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [interestModal, setInterestModal] = useState<InterestModalState | null>(null);
  const [selectedInterest, setSelectedInterest] = useState<ProposedInterest | null>(null);
  const [customInterest, setCustomInterest] = useState('');
  const [canonicalizing, setCanonicalizing] = useState(false);
  const [savingInterests, setSavingInterests] = useState(false);
  const [interestError, setInterestError] = useState<string | null>(null);
  const [tidyConfirmOpen, setTidyConfirmOpen] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [tidyNotice, setTidyNotice] = useState<string | null>(null);
  const [dismissedDomains, setDismissedDomains] = useState<string[]>([]);
  const [reinstating, setReinstating] = useState<string | null>(null);
  const [manageInterestsOpen, setManageInterestsOpen] = useState(false);
  const [sendQuestionOpen, setSendQuestionOpen] = useState(false);
  const [writeQuestionOpen, setWriteQuestionOpen] = useState(false);
  const [questionToast, setQuestionToast] = useState<string | null>(null);

  const loadKnowledge = async () => {
    const response = await fetch('/api/knowledge', { cache: 'no-store', credentials: 'include' });
    const body = await response.json().catch(() => null) as KnowledgeResponse | { message?: string } | null;
    if (!response.ok || !body || !('pageData' in body)) {
      throw new Error((body as { message?: string } | null)?.message ?? 'Could not load your Knowledge Map.');
    }
    setData(body);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const loadDismissedDomains = async () => {
      try {
        const response = await fetch('/api/feed/dismissed-domains', { cache: 'no-store', credentials: 'include' });
        const body = await response.json().catch(() => null) as { domains?: string[] } | null;
        if (active && response.ok && body?.domains) setDismissedDomains(body.domains);
      } catch {
        if (active) setDismissedDomains([]);
      }
    };

    Promise.all([loadKnowledge(), loadDismissedDomains()])
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load your Knowledge Map.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!tierCrossed) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('tier_crossed');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [tierCrossed]);

  useEffect(() => {
    if (manageInterestsParam !== 'manage') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('interests');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    setManageInterestsOpen(true);
  }, [manageInterestsParam]);

  useEffect(() => {
    if (!highlightedDomainSlug) return;
    setActiveSlug(highlightedDomainSlug);
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('domain');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      setActiveSlug(null);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [highlightedDomainSlug]);

  const sortedDomains = useMemo(
    () => [...(data?.pageData.allDomains ?? [])].sort((a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName)),
    [data],
  );

  const portraitEntries = useMemo(() => sortedDomains.map(toPortraitEntry), [sortedDomains]);
  const declaredSlots = useMemo(() => {
    if (!data) return [];
    const byKey = new Map(data.pageData.allDomains.map((domain) => [domainKey(domain.domain), domain]));
    const filled = data.pageData.declaredInterests.slice(0, 5).map((domain) => byKey.get(domainKey(domain)) ?? emptyDomain(domain));
    return Array.from({ length: 5 }, (_, index) => filled[index] ?? null);
  }, [data]);
  const declaredKeys = useMemo(() => new Set((data?.pageData.declaredInterests ?? []).map(domainKey)), [data]);
  const demonstratedChoices = useMemo(() => {
    if (!data) return [];
    return data.pageData.allDomains
      .filter((domain) => (domain.isDemonstrated || domain.points > 0) && !declaredKeys.has(domainKey(domain.domain)))
      .sort((a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName));
  }, [data, declaredKeys]);

  const topCardDomains = useMemo(() => sortedDomains.filter((domain) => domain.points > 0).slice(0, 5), [sortedDomains]);
  const yourMind = data ? displayMind(sortedDomains, data.pageData.declaredInterests) : '';
  const displayName = 'You';
  const hasAnything = sortedDomains.length > 0;

  const openInterestModal = (slotIndex: number, currentDomain: string | null) => {
    setInterestModal({ slotIndex, currentDomain });
    setSelectedInterest(null);
    setCustomInterest('');
    setInterestError(null);
  };

  const closeInterestModal = () => {
    if (savingInterests) return;
    setInterestModal(null);
    setSelectedInterest(null);
    setCustomInterest('');
    setInterestError(null);
  };

  const proposeCustomInterest = async () => {
    const raw = customInterest.trim();
    if (!raw) return;
    setCanonicalizing(true);
    setInterestError(null);
    try {
      const response = await fetch('/api/onboarding/propose-interests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ warmupAnswers: [raw] }),
      });
      const body = await response.json().catch(() => null) as { interests?: ProposedInterest[]; message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? 'Could not refine that interest.');
      const proposal = body?.interests?.[0];
      setSelectedInterest(proposal?.label ? proposal : { label: raw });
    } catch (caught) {
      setInterestError(caught instanceof Error ? caught.message : 'Could not refine that interest.');
      setSelectedInterest({ label: raw });
    } finally {
      setCanonicalizing(false);
    }
  };

  const confirmInterestChange = async () => {
    if (!interestModal || !selectedInterest?.label) return;
    setSavingInterests(true);
    setInterestError(null);
    const nextInterests = (declaredSlots
      .map((slot, index) => {
        if (index === interestModal.slotIndex) {
          return {
            label: selectedInterest.label.trim(),
            description: selectedInterest.description,
            broadCategory: selectedInterest.broadCategory,
          };
        }
        return slot ? { label: slot.domain, broadCategory: slot.broadCategory } : null;
      }) as Array<ProposedInterest | null>)
      .filter((interest): interest is ProposedInterest => Boolean(interest?.label.trim()))
      .slice(0, 5);

    try {
      const response = await fetch('/api/onboarding/save-interests', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interests: nextInterests }),
      });
      const body = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? 'Could not save your interests.');
      await loadKnowledge();
      closeInterestModal();
    } catch (caught) {
      setInterestError(caught instanceof Error ? caught.message : 'Could not save your interests.');
    } finally {
      setSavingInterests(false);
    }
  };

  const submitQuestion = async (values: QuestionFormValues) => {
    const response = await fetch('/api/questions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
    const body = await response.json().catch(() => null) as { message?: string } | null;
    if (!response.ok) throw new Error(body?.message ?? 'Could not save that question.');
    setSendQuestionOpen(false);
    setWriteQuestionOpen(false);
    if (values.sendToFriendIds.length > 0) {
      const n = values.sendToFriendIds.length;
      setQuestionToast(`Sent to ${n} ${n === 1 ? 'friend' : 'friends'}.`);
    } else if (values.shareToFeed) {
      setQuestionToast('Saved and shared with your friends.');
    } else {
      setQuestionToast('Saved to your bank.');
    }
    window.setTimeout(() => setQuestionToast(null), 2500);
  };

  const reinstateDomain = async (domain: string) => {
    setReinstating(domain);
    try {
      const response = await fetch('/api/feed/dismiss-domain', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      if (response.ok) {
        setDismissedDomains((current) => current.filter((d) => d !== domain));
      }
    } finally {
      setReinstating(null);
    }
  };

  const confirmTidy = async () => {
    setTidying(true);
    try {
      const response = await fetch('/api/knowledge/tidy', { method: 'POST', credentials: 'include' });
      const body = await response.json().catch(() => null) as TidyResult | { message?: string } | null;
      if (!response.ok || !body || !('mergesApplied' in body)) {
        throw new Error((body as { message?: string } | null)?.message ?? 'Could not tidy your map.');
      }
      await loadKnowledge();
      setTidyConfirmOpen(false);
      setTidyNotice(body.mergesApplied > 0 ? `${body.mergesApplied} domains combined` : 'Nothing to combine');
      window.setTimeout(() => setTidyNotice(null), 3600);
    } catch (caught) {
      setTidyNotice(caught instanceof Error ? caught.message : 'Could not tidy your map.');
      window.setTimeout(() => setTidyNotice(null), 4200);
    } finally {
      setTidying(false);
    }
  };

  if (loading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <main style={mainStyle}>
        <section style={sectionStyle}>
          <p style={eyebrowStyle}>Knowledge</p>
          <h1 style={sentenceStyle}>Could not load your map</h1>
          <p style={emptyStyle}>{error ?? 'Something went sideways.'}</p>
        </section>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      {tierCrossed && highlightedDomainSlug && (
        <section style={tierCrossedBannerStyle}>
          You reached {tierCrossed} in this domain this session.
        </section>
      )}

      <section style={headerSectionStyle} aria-label="Your Mind">
        <p style={eyebrowStyle}>Your Mind</p>
        <h1 style={sentenceStyle}>{yourMind}</h1>
        <p style={{ margin: '10px 0 0', fontSize: '0.82rem' }}>
          <Link href="/daily/setup" className="text-[var(--text-muted)] underline underline-offset-2">
            Personal Daily
          </Link>
        </p>
      </section>

      {topCardDomains.length > 0 && (
        <section style={sectionStyle} aria-label="Knowledge card">
          <KnowledgeCard
            playerDisplayName={displayName}
            portraitStatement={yourMind}
            domains={topCardDomains.map((domain) => ({
              canonicalSubcategory: domain.displayName,
              canonicalSubcategorySlug: toCanonicalDomainSlug(domain.domain),
              currentTier: asTier(domain.tier),
              lifetimePoints: domain.points,
              iconKey: domain.iconKey,
              broadCategory: domain.broadCategory,
            }))}
            overflowCount={Math.max(0, sortedDomains.filter((domain) => domain.points > 0).length - topCardDomains.length)}
            tierSignature={`${formatNumber(data.mastery.totalPoints)} knowledge points across ${sortedDomains.length} territories`}
            rarestTerritory={null}
            rarestTerritorySolo={false}
            shareText={`My Joshing knowledge portrait: ${topCardDomains.map((domain) => domain.displayName).join(', ')}`}
            shareCardToken=""
            shareCardExpiresAt=""
            readOnly
            highlightedSlug={activeSlug}
          />
        </section>
      )}

      {hasAnything && (
        <section style={sectionStyle} aria-label="Knowledge progression">
          <div style={knowledgeSectionHeaderStyle}>
            <p style={knowledgeEyebrowStyle}>YOUR KNOWLEDGE</p>
            <p style={knowledgeSubtitleStyle}>SEE HOW YOUR KNOWLEDGE IS BUILDING -&gt;</p>
          </div>

          <div id="portrait-circles-section">
            <PortraitCircles entries={portraitEntries} />
            <div style={sharePortraitWrapStyle}>
              <button type="button" style={sharePortraitBtnStyle} onClick={() => setShareModalOpen(true)}>
                Share portrait
              </button>
            </div>
          </div>
        </section>
      )}

      <section style={growMapSectionStyle}>
        <h2 style={growMapHeadingStyle}>Grow your map</h2>
        <p style={growMapBodyStyle}>Your map grows in two directions.</p>
        <p style={growMapBodyStyle}>When you send a friend a question and they answer it correctly, that domain joins your map. When a friend sends you a question and you answer it correctly, that domain joins your map too. Either direction works. Both are how it expands.</p>
        <p style={growMapBodyStyle}>Try asking a friend about something you&apos;d love to know more about — Disney World, 1970s BBC Drama, the 1956 Hungarian Uprising. The ask itself is the start.</p>
        <div style={growMapActionsStyle}>
          <button type="button" style={growMapPrimaryBtnStyle} onClick={() => setSendQuestionOpen(true)}>
            Send a friend a question
          </button>
          <button type="button" style={growMapSecondaryBtnStyle} onClick={() => setWriteQuestionOpen(true)}>
            Write a question
          </button>
        </div>
      </section>

      {dismissedDomains.length > 0 && (
        <section style={sectionStyle} aria-label="Dismissed domains">
          <p style={knowledgeEyebrowStyle}>FOCUSED FEED</p>
          <p style={knowledgeSubtitleStyle}>DOMAINS YOU'VE HIDDEN FROM YOUR FEED — RE-OPEN ANY TIME</p>
          <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {dismissedDomains.map((domain) => (
              <div key={domain} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <span style={{ fontSize: 14 }}>{domain}</span>
                <button
                  type="button"
                  style={linkButtonStyle}
                  onClick={() => void reinstateDomain(domain)}
                  disabled={reinstating === domain}
                >
                  {reinstating === domain ? 'Reopening...' : `Re-open ${domain} in your Feed`}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={maintenanceStyle}>
        <p style={emptyStyle}>Map maintenance</p>
        <button type="button" style={tidyButtonStyle} onClick={() => setTidyConfirmOpen(true)} disabled={tidying}>
          <Combine className="size-3.5" />
          Tidy up my map
        </button>
      </section>

      {shareModalOpen && (
        <SharePortraitModal entries={portraitEntries} playerDisplayName={displayName} onClose={() => setShareModalOpen(false)} />
      )}

      {interestModal ? (
        <div style={{ ...modalOverlayStyle, zIndex: 55 }}>
          <div style={modalStyle}>
            <div style={modalHeaderStyle}>
              <div>
                <h2 style={modalTitleStyle}>{interestModal.currentDomain ? `Swap ${interestModal.currentDomain}` : 'Add to your declared interests'}</h2>
                {interestModal.currentDomain ? (
                  <p style={modalCopyStyle}>Your progress in {interestModal.currentDomain} is preserved. It moves to your demonstrated knowledge.</p>
                ) : null}
              </div>
              <button type="button" style={iconButtonStyle} onClick={closeInterestModal} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            <div style={modalBodyStyle}>
              <div>
                <h3 style={modalSubheadStyle}>Pick from your knowledge base</h3>
                {demonstratedChoices.length === 0 ? (
                  <p style={choiceEmptyStyle}>No demonstrated domains are available to add right now.</p>
                ) : (
                  <div style={choiceListStyle}>
                    {demonstratedChoices.map((domain) => (
                      <button
                        key={domain.domain}
                        type="button"
                        style={selectedInterest?.label === domain.domain ? selectedChoiceStyle : choiceButtonStyle}
                        onClick={() => setSelectedInterest({ label: domain.domain, broadCategory: domain.broadCategory ?? undefined })}
                      >
                        <span>{domain.displayName}</span>
                        <span>{asTier(domain.tier)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 style={modalSubheadStyle}>Write a new interest</h3>
                <div style={customInterestRowStyle}>
                  <input
                    value={customInterest}
                    onChange={(event) => setCustomInterest(event.target.value)}
                    placeholder="Late-period Bowie, Weimar cinema..."
                    style={inputStyle}
                  />
                  <button type="button" style={modalPrimaryStyle} disabled={!customInterest.trim() || canonicalizing} onClick={() => void proposeCustomInterest()}>
                    {canonicalizing ? 'Refining...' : 'Refine'}
                  </button>
                </div>
                {selectedInterest ? (
                  <div style={selectedInterestStyle}>
                    <p style={{ margin: 0, fontWeight: 600 }}>{selectedInterest.label}</p>
                    {selectedInterest.description ? <p style={modalCopyStyle}>{selectedInterest.description}</p> : null}
                    <button type="button" style={linkButtonStyle} onClick={() => setSelectedInterest({ label: customInterest.trim() || selectedInterest.label })}>
                      Use my wording
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {interestError ? <p style={errorStyle}>{interestError}</p> : null}

            <div style={modalActionsStyle}>
              <button type="button" style={modalSecondaryStyle} onClick={closeInterestModal} disabled={savingInterests}>Cancel</button>
              <button type="button" style={modalPrimaryStyle} onClick={() => void confirmInterestChange()} disabled={!selectedInterest?.label || savingInterests}>
                {savingInterests ? 'Saving...' : interestModal.currentDomain ? 'Confirm swap' : 'Confirm add'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tidyConfirmOpen ? (
        <div style={modalOverlayStyle}>
          <div style={smallModalStyle}>
            <div style={modalHeaderStyle}>
              <div>
                <h2 style={modalTitleStyle}>Tidy up your map?</h2>
                <p style={modalCopyStyle}>We'll look for domains in your map that could be combined. This is automatic and based on what you've answered.</p>
              </div>
              <button type="button" style={iconButtonStyle} onClick={() => setTidyConfirmOpen(false)} aria-label="Close" disabled={tidying}>
                <X className="size-4" />
              </button>
            </div>
            <div style={modalActionsStyle}>
              <button type="button" style={modalSecondaryStyle} onClick={() => setTidyConfirmOpen(false)} disabled={tidying}>Cancel</button>
              <button type="button" style={modalPrimaryStyle} onClick={() => void confirmTidy()} disabled={tidying}>
                {tidying ? 'Tidying...' : 'Confirm tidy'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tidyNotice ? <div style={toastStyle}>{tidyNotice}</div> : null}
      {questionToast ? <div style={{ ...toastStyle, bottom: tidyNotice ? 64 : 20 }}>{questionToast}</div> : null}

      {manageInterestsOpen ? (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <div style={modalHeaderStyle}>
              <div>
                <h2 style={modalTitleStyle}>Manage interests</h2>
                <p style={modalCopyStyle}>Your five declared interests seed your Daily Five questions.</p>
              </div>
              <button type="button" style={iconButtonStyle} onClick={() => setManageInterestsOpen(false)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div style={{ ...declaredGridStyle, marginTop: 20 }}>
              {declaredSlots.map((slot, index) => (
                <div key={slot?.domain ?? `empty-${index}`} style={declaredCardStyle}>
                  {slot ? (
                    <>
                      <div style={{ minWidth: 0 }}>
                        <h3 style={declaredTitleStyle}>{slot.displayName}</h3>
                        <p style={declaredMetaStyle}>{slot.broadCategory ?? asTier(slot.tier)}</p>
                      </div>
                      <button type="button" style={declaredButtonStyle} onClick={() => openInterestModal(index, slot.domain)}>
                        <Repeat2 className="size-3.5" />
                        Swap
                      </button>
                    </>
                  ) : (
                    <button type="button" style={emptyDeclaredButtonStyle} onClick={() => openInterestModal(index, null)}>
                      <Plus className="size-4" />
                      Add interest
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ ...modalActionsStyle, justifyContent: 'flex-start', marginTop: 16 }}>
              <button type="button" style={modalSecondaryStyle} onClick={() => setManageInterestsOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {sendQuestionOpen ? (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalStyle, maxHeight: '92vh' }}>
            <div style={modalHeaderStyle}>
              <h2 style={modalTitleStyle}>Send a friend a question</h2>
              <button type="button" style={iconButtonStyle} onClick={() => setSendQuestionOpen(false)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div style={{ marginTop: 20 }}>
              <QuestionForm
                initialSpecificMode
                onSubmit={submitQuestion}
                submitLabel="Send question"
                onCancel={() => setSendQuestionOpen(false)}
              />
            </div>
          </div>
        </div>
      ) : null}

      {writeQuestionOpen ? (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalStyle, maxHeight: '92vh' }}>
            <div style={modalHeaderStyle}>
              <h2 style={modalTitleStyle}>Write a question</h2>
              <button type="button" style={iconButtonStyle} onClick={() => setWriteQuestionOpen(false)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div style={{ marginTop: 20 }}>
              <QuestionForm
                onSubmit={submitQuestion}
                submitLabel="Save question"
                onCancel={() => setWriteQuestionOpen(false)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

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

const declaredGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))',
  gap: '0.6rem',
  marginTop: '0.85rem',
};

const declaredCardStyle: CSSProperties = {
  minHeight: 132,
  border: '1px solid #e8e2d6',
  borderRadius: 8,
  padding: '0.75rem',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  background: '#fdfbf6',
};

const declaredTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  lineHeight: 1.25,
  color: '#1a1208',
};

const declaredMetaStyle: CSSProperties = {
  margin: '0.25rem 0 0',
  color: '#8a8070',
  fontSize: '0.72rem',
};

const declaredButtonStyle: CSSProperties = {
  minHeight: 34,
  border: '1px solid #ddd6c7',
  background: '#fff',
  color: '#696257',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontSize: '0.68rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  cursor: 'pointer',
};

const emptyDeclaredButtonStyle: CSSProperties = {
  minHeight: 104,
  border: '1px dashed #c8c0b0',
  background: 'transparent',
  color: '#8a8070',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  fontSize: '0.82rem',
  cursor: 'pointer',
};

const maintenanceStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  borderTop: '1px solid #ddd6c7',
  padding: '0.85rem 0.2rem 0',
};

const tidyButtonStyle: CSSProperties = {
  minHeight: 36,
  border: '1px solid #ddd6c7',
  background: '#ffffff',
  color: '#1a1208',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '0 12px',
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  cursor: 'pointer',
};

const modalOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.3)',
  padding: 16,
};

const modalStyle: CSSProperties = {
  width: 'min(540px, 100%)',
  maxHeight: '90vh',
  overflowY: 'auto',
  background: '#fff',
  border: '1px solid #ddd6c7',
  padding: 20,
  boxShadow: '0 18px 48px rgba(0,0,0,0.18)',
};

const smallModalStyle: CSSProperties = {
  ...modalStyle,
  width: 'min(430px, 100%)',
};

const modalHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
};

const modalTitleStyle: CSSProperties = {
  margin: 0,
  color: '#1a1208',
  fontSize: '1.45rem',
  fontFamily: 'var(--font-literata), serif',
};

const modalCopyStyle: CSSProperties = {
  margin: '0.45rem 0 0',
  color: '#696257',
  fontSize: '0.88rem',
  lineHeight: 1.5,
};

const iconButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  border: 'none',
  background: 'transparent',
  color: '#8a8070',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
};

const modalBodyStyle: CSSProperties = {
  display: 'grid',
  gap: 20,
  marginTop: 20,
};

const modalSubheadStyle: CSSProperties = {
  margin: 0,
  color: '#1a1208',
  fontSize: '0.9rem',
};

const choiceEmptyStyle: CSSProperties = {
  margin: '0.5rem 0 0',
  border: '1px solid #e8e2d6',
  padding: 12,
  color: '#696257',
  fontSize: '0.88rem',
};

const choiceListStyle: CSSProperties = {
  marginTop: 8,
  maxHeight: 176,
  overflowY: 'auto',
  border: '1px solid #e8e2d6',
};

const choiceButtonStyle: CSSProperties = {
  width: '100%',
  minHeight: 38,
  border: 'none',
  borderBottom: '1px solid #e8e2d6',
  background: '#fff',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '0 12px',
  color: '#696257',
  cursor: 'pointer',
};

const selectedChoiceStyle: CSSProperties = {
  ...choiceButtonStyle,
  background: '#f5f0e8',
  color: '#1a1208',
};

const customInterestRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 8,
};

const inputStyle: CSSProperties = {
  minHeight: 40,
  flex: 1,
  border: '1px solid #ddd6c7',
  padding: '0 10px',
  background: '#fff',
  color: '#1a1208',
};

const selectedInterestStyle: CSSProperties = {
  marginTop: 12,
  border: '1px solid #e8e2d6',
  background: '#fdfbf6',
  padding: 12,
};

const linkButtonStyle: CSSProperties = {
  marginTop: 8,
  border: 'none',
  background: 'transparent',
  color: '#696257',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
  fontSize: '0.76rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const errorStyle: CSSProperties = {
  margin: '1rem 0 0',
  border: '1px solid #c0392b66',
  color: '#8b1a0e',
  padding: 12,
  fontSize: '0.88rem',
};

const modalActionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 20,
};

const modalSecondaryStyle: CSSProperties = {
  minHeight: 40,
  border: '1px solid #ddd6c7',
  background: '#fff',
  color: '#696257',
  padding: '0 16px',
  cursor: 'pointer',
};

const modalPrimaryStyle: CSSProperties = {
  minHeight: 40,
  border: '1px solid #1a1208',
  background: '#1a1208',
  color: '#f5f0e8',
  padding: '0 16px',
  cursor: 'pointer',
};

const growMapSectionStyle: CSSProperties = {
  background: '#fdfbf6',
  border: '1px solid #ddd6c7',
  padding: '1.25rem 0.95rem',
};

const growMapHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.1rem',
  fontFamily: 'var(--font-literata), serif',
  color: '#1a1208',
};

const growMapBodyStyle: CSSProperties = {
  margin: '0.75rem 0 0',
  fontSize: '0.88rem',
  lineHeight: 1.6,
  color: '#696257',
};

const growMapActionsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: '1.25rem',
};

const growMapPrimaryBtnStyle: CSSProperties = {
  minHeight: 40,
  border: '1px solid #1a1208',
  background: '#1a1208',
  color: '#f5f0e8',
  padding: '0 16px',
  cursor: 'pointer',
  fontSize: '0.82rem',
  fontFamily: 'inherit',
};

const growMapSecondaryBtnStyle: CSSProperties = {
  minHeight: 40,
  border: '1px solid #ddd6c7',
  background: '#fff',
  color: '#1a1208',
  padding: '0 16px',
  cursor: 'pointer',
  fontSize: '0.82rem',
  fontFamily: 'inherit',
};

const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: 20,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 60,
  border: '1px solid #ddd6c7',
  background: '#fff',
  color: '#1a1208',
  padding: '9px 16px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
  fontSize: '0.88rem',
};
