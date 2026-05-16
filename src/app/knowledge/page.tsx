'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Combine, Plus, Repeat2, X } from 'lucide-react';
import { QuestionForm, type QuestionFormValues } from '@/components/QuestionForm';

import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard';
import { PortraitCircles, type PortraitEntry } from '@/components/knowledge/PortraitCircles';
import { SharePortraitModal } from '@/components/knowledge/SharePortraitModal';
import { RecentlyExpanding, type ExpandingDomain } from '@/components/knowledge/RecentlyExpanding';
import { AskFriendForDomain } from '@/components/knowledge/AskFriendForDomain';
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
    expandingDomains: ExpandingDomain[];
  };
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

type CreateQuestionResponse = {
  message?: string;
  feedShare?: {
    requested: boolean;
    createdCount: number;
    friendCount?: number;
    sharedRecipientIds?: string[];
    skippedDismissedDomainRecipientIds?: string[];
    skippedExistingFeedRecipientIds?: string[];
  };
};

type ActiveModal =
  | null
  | { type: 'interests'; slotIndex: number; currentDomain: string | null }
  | { type: 'manage-interests' }
  | { type: 'send-question' }
  | { type: 'write-question' }
  | { type: 'tidy' };

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
    broadCategory: normalizeBroadCategory(domain.broadCategory) ?? 'General Knowledge',
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
    <main className="w-[min(760px,94vw)] mx-auto pt-5 pb-10 grid gap-[0.9rem]">
      <section className="bg-white border border-[#ddd6c7] p-4">
        <p className="m-0 text-[#696257]">Loading...</p>
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
  const emptyDomainParam = searchParams.get('emptyDomain')?.trim() || searchParams.get('askDomain')?.trim() || '';
  const emptyQuestionDomain = emptyDomainParam || null;

  const [data, setData] = useState<KnowledgeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(highlightedDomainSlug);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [selectedInterest, setSelectedInterest] = useState<ProposedInterest | null>(null);
  const [customInterest, setCustomInterest] = useState('');
  const [canonicalizing, setCanonicalizing] = useState(false);
  const [savingInterests, setSavingInterests] = useState(false);
  const [interestError, setInterestError] = useState<string | null>(null);
  const [tidying, setTidying] = useState(false);
  const [tidyNotice, setTidyNotice] = useState<string | null>(null);
  const [dismissedDomains, setDismissedDomains] = useState<string[]>([]);
  const [reinstating, setReinstating] = useState<string | null>(null);
  const [questionToast, setQuestionToast] = useState<string | null>(null);
  const [askFriendDomain, setAskFriendDomain] = useState<string | null>(null);

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
    const loadDismissedDomains = async () => {
      try {
        const response = await fetch('/api/feed/dismissed-domains', { cache: 'no-store', credentials: 'include' });
        const body = await response.json().catch(() => null) as { domains?: string[] } | null;
        if (active && response.ok && body?.domains) setDismissedDomains(body.domains);
      } catch {
        if (active) setDismissedDomains([]);
      }
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial page hydration is fetched client-side for this route.
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
    window.setTimeout(() => setActiveModal({ type: 'manage-interests' }), 0);
  }, [manageInterestsParam]);

  useEffect(() => {
    if (!highlightedDomainSlug) return;
    const activateTimer = window.setTimeout(() => setActiveSlug(highlightedDomainSlug), 0);
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('domain');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      setActiveSlug(null);
    }, 900);
    return () => {
      window.clearTimeout(activateTimer);
      window.clearTimeout(timer);
    };
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
  const expandingDomains = data?.pageData.expandingDomains ?? [];
  const showShareNotice = (message: string) => {
    setQuestionToast(message);
    window.setTimeout(() => setQuestionToast(null), 2200);
  };
  const yourMind = data ? displayMind(sortedDomains, data.pageData.declaredInterests) : '';
  const displayName = 'You';
  const hasAnything = sortedDomains.length > 0;

  // openInterestModal is always triggered from within manage-interests, so closing returns there.
  const openInterestModal = (slotIndex: number, currentDomain: string | null) => {
    setActiveModal({ type: 'interests', slotIndex, currentDomain });
    setSelectedInterest(null);
    setCustomInterest('');
    setInterestError(null);
  };

  const closeInterestModal = () => {
    if (savingInterests) return;
    setActiveModal({ type: 'manage-interests' });
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
    if (activeModal?.type !== 'interests' || !selectedInterest?.label) return;
    const modal = activeModal;
    setSavingInterests(true);
    setInterestError(null);
    const nextInterests = (declaredSlots
      .map((slot, index) => {
        if (index === modal.slotIndex) {
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
    const body = await response.json().catch(() => null) as CreateQuestionResponse | null;
    if (!response.ok) throw new Error(body?.message ?? 'Could not save that question.');
    setActiveModal(null);
    if (values.sendToFriendIds.length > 0) {
      const n = values.sendToFriendIds.length;
      setQuestionToast(`Sent to ${n} ${n === 1 ? 'friend' : 'friends'}.`);
    } else if (body?.feedShare?.createdCount && body.feedShare.createdCount > 0) {
      const n = body.feedShare.createdCount;
      setQuestionToast(`Saved and shared with ${n} ${n === 1 ? 'friend' : 'friends'}.`);
    } else if (body?.feedShare?.requested && body.feedShare.createdCount === 0) {
      setQuestionToast('No friends received this because they already had it or filtered that domain.');
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
      setActiveModal(null);
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
      <main className="w-[min(760px,94vw)] mx-auto pt-5 pb-10 grid gap-[0.9rem]">
        <section className="bg-white border border-[#ddd6c7] p-4">
          <p className="m-0 text-[0.72rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Knowledge</p>
          <h1 className="mt-[0.35rem] text-[clamp(1.1rem,2.5vw,1.55rem)] leading-[1.35] text-[#111111] font-[var(--font-neutral)] font-semibold">Could not load your map</h1>
          <p className="m-0 text-[#696257]">{error ?? 'Something went sideways.'}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="w-[min(760px,94vw)] mx-auto pt-5 pb-10 grid gap-[0.9rem]">
      {tierCrossed && highlightedDomainSlug && (
        <section className="bg-[#f0e6c8] text-[#1a1208] px-[0.95rem] py-3 text-base">
          You reached {tierCrossed} in this domain this session.
        </section>
      )}

      <section className="bg-white border border-[#ddd6c7] p-4" aria-label="Your Mind">
        <p className="m-0 text-[0.72rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Your Mind</p>
        <h1 className="mt-[0.35rem] text-[clamp(1.1rem,2.5vw,1.55rem)] leading-[1.35] text-[#111111] font-[var(--font-neutral)] font-semibold">{yourMind}</h1>
        <p className="mt-[10px] text-[0.82rem]">
          <Link href="/daily/setup" className="text-[var(--text-muted)] underline underline-offset-2">
            Personal Daily
          </Link>
        </p>
      </section>

      {topCardDomains.length > 0 && (
        <section className="bg-white border border-[#ddd6c7] p-4" aria-label="Knowledge card">
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
        <section className="bg-white border border-[#ddd6c7] p-4" aria-label="Knowledge progression">
          <div className="mb-2">
            <p className="m-0 text-[13px] [font-variant:small-caps] text-[#1a1208] font-[var(--font-neutral)] tracking-[0.06em]">YOUR KNOWLEDGE</p>
            <p className="mt-[0.15rem] text-[10px] [font-variant:small-caps] text-[#8a8070] tracking-[0.06em] font-[var(--font-neutral)]">SEE HOW YOUR KNOWLEDGE IS BUILDING -&gt;</p>
          </div>

          <div id="portrait-circles-section">
            <PortraitCircles entries={portraitEntries} />
            <div className="mt-5 flex justify-center">
              <button type="button" className="px-8 py-[11px] border-[1.5px] border-[#0e0e0e] bg-[#0e0e0e] text-[#faf8f2] font-['Courier_New',monospace] text-xs tracking-[0.12em] uppercase cursor-pointer shadow-[2px_2px_0_#3a3a3a]" onClick={() => setShareModalOpen(true)}>
                Share portrait
              </button>
            </div>
          </div>
        </section>
      )}

      <RecentlyExpanding domains={expandingDomains} playerDisplayName={displayName} onNotice={showShareNotice} />

      {emptyQuestionDomain ? (
        <section className="bg-[#fff7e8] border border-[#d9b56c] px-[0.95rem] py-5" aria-label={`No ${emptyQuestionDomain} questions yet`}>
          <p className="m-0 text-[13px] [font-variant:small-caps] text-[#1a1208] font-[var(--font-neutral)] tracking-[0.06em]">No matching public questions</p>
          <h2 className="mt-[0.4rem] text-[1.25rem] leading-[1.35] text-[#1a1208] font-[var(--font-literata)] font-semibold">We don&apos;t have {emptyQuestionDomain} questions yet. Want to ask someone who might?</h2>
          <p className="mt-3 text-[0.88rem] leading-[1.6] text-[#696257]">Josh is going deep on {emptyQuestionDomain} — and thinks someone in your world might be the one to stump them.</p>
          <div className="flex flex-wrap gap-[10px] mt-5">
            <button type="button" className="min-h-10 border border-[#1a1208] bg-[#1a1208] text-[#f5f0e8] px-4 cursor-pointer text-[0.82rem] font-[inherit]" onClick={() => setAskFriendDomain(emptyQuestionDomain)}>
              Ask a friend
            </button>
            <button type="button" className="min-h-10 border border-[#ddd6c7] bg-white text-[#1a1208] px-4 cursor-pointer text-[0.82rem] font-[inherit]" onClick={() => setActiveModal({ type: 'write-question' })}>
              Write one myself
            </button>
          </div>
        </section>
      ) : null}

      <section className="bg-[#fdfbf6] border border-[#ddd6c7] px-[0.95rem] py-5">
        <h2 className="m-0 text-[1.1rem] font-[var(--font-literata)] text-[#1a1208]">Grow your map</h2>
        <p className="mt-3 text-[0.88rem] leading-[1.6] text-[#696257]">Your map grows in two directions.</p>
        <p className="mt-3 text-[0.88rem] leading-[1.6] text-[#696257]">When you send a friend a question and they answer it correctly, that domain joins your map. When a friend sends you a question and you answer it correctly, that domain joins your map too. Either direction works. Both are how it expands.</p>
        <p className="mt-3 text-[0.88rem] leading-[1.6] text-[#696257]">Try asking a friend about something you&apos;d love to know more about — Disney World, 1970s BBC Drama, the 1956 Hungarian Uprising. The ask itself is the start.</p>
        <div className="flex flex-wrap gap-[10px] mt-5">
          <button type="button" className="min-h-10 border border-[#1a1208] bg-[#1a1208] text-[#f5f0e8] px-4 cursor-pointer text-[0.82rem] font-[inherit]" onClick={() => setActiveModal({ type: 'send-question' })}>
            Send a friend a question
          </button>
          <button type="button" className="min-h-10 border border-[#ddd6c7] bg-white text-[#1a1208] px-4 cursor-pointer text-[0.82rem] font-[inherit]" onClick={() => setActiveModal({ type: 'write-question' })}>
            Write a question
          </button>
        </div>
      </section>

      {dismissedDomains.length > 0 && (
        <section className="bg-white border border-[#ddd6c7] p-4" aria-label="Dismissed domains">
          <p className="m-0 text-[13px] [font-variant:small-caps] text-[#1a1208] font-[var(--font-neutral)] tracking-[0.06em]">FOCUSED FEED</p>
          <p className="mt-[0.15rem] text-[10px] [font-variant:small-caps] text-[#8a8070] tracking-[0.06em] font-[var(--font-neutral)]">DOMAINS YOU&rsquo;VE HIDDEN FROM YOUR FEED — RE-OPEN ANY TIME</p>
          <div className="mt-3 flex flex-col gap-2">
            {dismissedDomains.map((domain) => (
              <div key={domain} className="flex items-center justify-between gap-2">
                <span className="text-sm">{domain}</span>
                <button
                  type="button"
                  className="mt-2 border-none bg-transparent text-[#696257] underline cursor-pointer p-0 text-[0.76rem] uppercase tracking-[0.08em]"
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

      <section className="flex items-center justify-between gap-4 border-t border-[#ddd6c7] pt-[0.85rem] px-[0.2rem]">
        <p className="m-0 text-[#696257]">Map maintenance</p>
        <button type="button" className="min-h-9 border border-[#ddd6c7] bg-white text-[#1a1208] inline-flex items-center justify-center gap-2 px-3 text-[0.7rem] uppercase tracking-[0.08em] cursor-pointer" onClick={() => setActiveModal({ type: 'tidy' })} disabled={tidying}>
          <Combine className="size-3.5" />
          Tidy up my map
        </button>
      </section>

      {shareModalOpen && (
        <SharePortraitModal entries={portraitEntries} playerDisplayName={displayName} onClose={() => setShareModalOpen(false)} />
      )}

      {askFriendDomain ? (
        <AskFriendForDomain key={askFriendDomain} domain={askFriendDomain} onClose={() => setAskFriendDomain(null)} />
      ) : null}

      {activeModal?.type === 'interests' ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 p-4">
          <div className="w-[min(540px,100%)] max-h-[90vh] overflow-y-auto bg-white border border-[#ddd6c7] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
            <div className="flex justify-between gap-4">
              <div>
                <h2 className="m-0 text-[#1a1208] text-[1.45rem] font-[var(--font-literata)]">{activeModal.currentDomain ? `Swap ${activeModal.currentDomain}` : 'Add to your declared interests'}</h2>
                {activeModal.currentDomain ? (
                  <p className="mt-[0.45rem] text-[#696257] text-[0.88rem] leading-[1.5]">Your progress in {activeModal.currentDomain} is preserved. It moves to your demonstrated knowledge.</p>
                ) : null}
              </div>
              <button type="button" className="w-[34px] h-[34px] border-none bg-transparent text-[#8a8070] grid place-items-center cursor-pointer" onClick={closeInterestModal} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            <div className="grid gap-5 mt-5">
              <div>
                <h3 className="m-0 text-[#1a1208] text-[0.9rem]">Pick from your knowledge base</h3>
                {demonstratedChoices.length === 0 ? (
                  <p className="mt-2 border border-[#e8e2d6] p-3 text-[#696257] text-[0.88rem]">No demonstrated domains are available to add right now.</p>
                ) : (
                  <div className="mt-2 max-h-[176px] overflow-y-auto border border-[#e8e2d6]">
                    {demonstratedChoices.map((domain) => (
                      <button
                        key={domain.domain}
                        type="button"
                        className={`w-full min-h-[38px] border-0 border-b border-b-[#e8e2d6] flex justify-between gap-3 px-3 cursor-pointer ${selectedInterest?.label === domain.domain ? 'bg-[#f5f0e8] text-[#1a1208]' : 'bg-white text-[#696257]'}`}
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
                <h3 className="m-0 text-[#1a1208] text-[0.9rem]">Write a new interest</h3>
                <div className="flex gap-2 mt-2">
                  <input
                    value={customInterest}
                    onChange={(event) => setCustomInterest(event.target.value)}
                    placeholder="Late-period Bowie, Weimar cinema..."
                    className="min-h-10 flex-1 border border-[#ddd6c7] px-[10px] bg-white text-[#1a1208]"
                  />
                  <button type="button" className="min-h-10 border border-[#1a1208] bg-[#1a1208] text-[#f5f0e8] px-4 cursor-pointer" disabled={!customInterest.trim() || canonicalizing} onClick={() => void proposeCustomInterest()}>
                    {canonicalizing ? 'Refining...' : 'Refine'}
                  </button>
                </div>
                {selectedInterest ? (
                  <div className="mt-3 border border-[#e8e2d6] bg-[#fdfbf6] p-3">
                    <p className="m-0 font-semibold">{selectedInterest.label}</p>
                    {selectedInterest.description ? <p className="mt-[0.45rem] text-[#696257] text-[0.88rem] leading-[1.5]">{selectedInterest.description}</p> : null}
                    <button type="button" className="mt-2 border-none bg-transparent text-[#696257] underline cursor-pointer p-0 text-[0.76rem] uppercase tracking-[0.08em]" onClick={() => setSelectedInterest({ label: customInterest.trim() || selectedInterest.label })}>
                      Use my wording
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {interestError ? <p className="mt-4 border border-[#c0392b]/40 text-[#8b1a0e] p-3 text-[0.88rem]">{interestError}</p> : null}

            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="min-h-10 border border-[#ddd6c7] bg-white text-[#696257] px-4 cursor-pointer" onClick={closeInterestModal} disabled={savingInterests}>Cancel</button>
              <button type="button" className="min-h-10 border border-[#1a1208] bg-[#1a1208] text-[#f5f0e8] px-4 cursor-pointer" onClick={() => void confirmInterestChange()} disabled={!selectedInterest?.label || savingInterests}>
                {savingInterests ? 'Saving...' : activeModal.currentDomain ? 'Confirm swap' : 'Confirm add'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal?.type === 'tidy' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-[min(430px,100%)] max-h-[90vh] overflow-y-auto bg-white border border-[#ddd6c7] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
            <div className="flex justify-between gap-4">
              <div>
                <h2 className="m-0 text-[#1a1208] text-[1.45rem] font-[var(--font-literata)]">Tidy up your map?</h2>
                <p className="mt-[0.45rem] text-[#696257] text-[0.88rem] leading-[1.5]">We&apos;ll look for domains in your map that could be combined. This is automatic and based on what you&apos;ve answered.</p>
              </div>
              <button type="button" className="w-[34px] h-[34px] border-none bg-transparent text-[#8a8070] grid place-items-center cursor-pointer" onClick={() => setActiveModal(null)} aria-label="Close" disabled={tidying}>
                <X className="size-4" />
              </button>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="min-h-10 border border-[#ddd6c7] bg-white text-[#696257] px-4 cursor-pointer" onClick={() => setActiveModal(null)} disabled={tidying}>Cancel</button>
              <button type="button" className="min-h-10 border border-[#1a1208] bg-[#1a1208] text-[#f5f0e8] px-4 cursor-pointer" onClick={() => void confirmTidy()} disabled={tidying}>
                {tidying ? 'Tidying...' : 'Confirm tidy'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tidyNotice ? <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] border border-[#ddd6c7] bg-white text-[#1a1208] px-4 py-[9px] shadow-[0_8px_24px_rgba(0,0,0,0.16)] text-[0.88rem]">{tidyNotice}</div> : null}
      {questionToast ? (
        <div
          style={{ bottom: tidyNotice ? 64 : 20 }}
          className="fixed left-1/2 -translate-x-1/2 z-[60] border border-[#ddd6c7] bg-white text-[#1a1208] px-4 py-[9px] shadow-[0_8px_24px_rgba(0,0,0,0.16)] text-[0.88rem]"
        >
          {questionToast}
        </div>
      ) : null}

      {activeModal?.type === 'manage-interests' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-[min(540px,100%)] max-h-[90vh] overflow-y-auto bg-white border border-[#ddd6c7] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
            <div className="flex justify-between gap-4">
              <div>
                <h2 className="m-0 text-[#1a1208] text-[1.45rem] font-[var(--font-literata)]">Manage interests</h2>
                <p className="mt-[0.45rem] text-[#696257] text-[0.88rem] leading-[1.5]">Your five declared interests seed your Daily Five questions.</p>
              </div>
              <button type="button" className="w-[34px] h-[34px] border-none bg-transparent text-[#8a8070] grid place-items-center cursor-pointer" onClick={() => setActiveModal(null)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-[0.6rem] mt-5">
              {declaredSlots.map((slot, index) => (
                <div key={slot?.domain ?? `empty-${index}`} className="min-h-[132px] border border-[#e8e2d6] rounded-lg p-3 flex flex-col justify-between bg-[#fdfbf6]">
                  {slot ? (
                    <>
                      <div className="min-w-0">
                        <h3 className="m-0 text-[0.9rem] leading-[1.25] text-[#1a1208]">{slot.displayName}</h3>
                        <p className="mt-1 text-[#8a8070] text-[0.72rem]">{slot.broadCategory ?? asTier(slot.tier)}</p>
                      </div>
                      <button type="button" className="min-h-[34px] border border-[#ddd6c7] bg-white text-[#696257] inline-flex items-center justify-center gap-[6px] text-[0.68rem] uppercase tracking-[0.08em] cursor-pointer" onClick={() => openInterestModal(index, slot.domain)}>
                        <Repeat2 className="size-3.5" />
                        Swap
                      </button>
                    </>
                  ) : (
                    <button type="button" className="min-h-[104px] border border-dashed border-[#c8c0b0] bg-transparent text-[#8a8070] flex flex-col items-center justify-center gap-2 text-[0.82rem] cursor-pointer w-full" onClick={() => openInterestModal(index, null)}>
                      <Plus className="size-4" />
                      Add interest
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-start gap-2 mt-4">
              <button type="button" className="min-h-10 border border-[#ddd6c7] bg-white text-[#696257] px-4 cursor-pointer" onClick={() => setActiveModal(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal?.type === 'send-question' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-[min(540px,100%)] max-h-[92vh] overflow-y-auto bg-white border border-[#ddd6c7] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
            <div className="flex justify-between gap-4">
              <h2 className="m-0 text-[#1a1208] text-[1.45rem] font-[var(--font-literata)]">Send a friend a question</h2>
              <button type="button" className="w-[34px] h-[34px] border-none bg-transparent text-[#8a8070] grid place-items-center cursor-pointer" onClick={() => setActiveModal(null)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-5">
              <QuestionForm
                initialSpecificMode
                onSubmit={submitQuestion}
                submitLabel="Send question"
                onCancel={() => setActiveModal(null)}
              />
            </div>
          </div>
        </div>
      ) : null}

      {activeModal?.type === 'write-question' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-[min(540px,100%)] max-h-[92vh] overflow-y-auto bg-white border border-[#ddd6c7] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
            <div className="flex justify-between gap-4">
              <h2 className="m-0 text-[#1a1208] text-[1.45rem] font-[var(--font-literata)]">Write a question</h2>
              <button type="button" className="w-[34px] h-[34px] border-none bg-transparent text-[#8a8070] grid place-items-center cursor-pointer" onClick={() => setActiveModal(null)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-5">
              <QuestionForm
                onSubmit={submitQuestion}
                submitLabel="Save question"
                onCancel={() => setActiveModal(null)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
