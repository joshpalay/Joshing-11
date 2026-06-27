'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Combine, Plus, Repeat2, Trash2, X } from 'lucide-react';
import { QuestionForm, type QuestionFormValues } from '@/components/QuestionForm';
import { Skeleton } from '@/components/ui/Skeleton';

import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard';
import { PortraitCircles, type PortraitEntry } from '@/components/knowledge/PortraitCircles';
import { SharePortraitModal } from '@/components/knowledge/SharePortraitModal';
import { RecentlyExpanding, type ExpandingDomain } from '@/components/knowledge/RecentlyExpanding';
import { AskFriendForDomain } from '@/components/knowledge/AskFriendForDomain';
import { toCanonicalDomainSlug } from '@/server/profile/domain-slug';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';
import { isTooBroadInterest } from '@/lib/knowledge/interest-specificity';
import { domainKey } from '@/lib/knowledge/domain-key';
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
  isHidden?: boolean;
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
  | { type: 'write-question' }
  | { type: 'tidy' };

// How long the write-question modal stays open after a successful save so the
// QuestionForm's in-form success confirmation registers before we close it.
const SUCCESS_HOLD_MS = 1100;

function asTier(value: string): MasteryTier {
  if (value === 'familiar' || value === 'solid' || value === 'mastery') return value;
  return 'establishing';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
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
    isHidden: Boolean(domain.isHidden),
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
    <main className="w-[min(672px,94vw)] mx-auto pt-5 pb-24 grid gap-3.5">
      <div className="grid gap-3.5" aria-hidden="true">
        <Skeleton className="h-36" />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      </div>
      <span className="sr-only" role="status">
        Loading your knowledge map…
      </span>
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
  // Specific choices a too-broad written interest expanded into (null = none).
  const [interestChoices, setInterestChoices] = useState<ProposedInterest[] | null>(null);
  const [savingInterests, setSavingInterests] = useState(false);
  const [interestError, setInterestError] = useState<string | null>(null);
  const [tidying, setTidying] = useState(false);
  const [tidyNotice, setTidyNotice] = useState<string | null>(null);
  const [dismissedDomains, setDismissedDomains] = useState<string[]>([]);
  const [reinstating, setReinstating] = useState<string | null>(null);
  const [questionToast, setQuestionToast] = useState<string | null>(null);
  const [askFriendDomain, setAskFriendDomain] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [hiddenOverrides, setHiddenOverrides] = useState<Record<string, boolean>>({});
  const [hidePending, setHidePending] = useState<string | null>(null);
  const [hideError, setHideError] = useState<string | null>(null);

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

  const isDomainHidden = useMemo(() => {
    return (domain: DomainMastery) => {
      const override = hiddenOverrides[domain.displayName];
      if (typeof override === 'boolean') return override;
      return Boolean(domain.isHidden);
    };
  }, [hiddenOverrides]);

  const annotatedDomains = useMemo(
    () => sortedDomains.map((domain) => ({ ...domain, isHidden: isDomainHidden(domain) })),
    [sortedDomains, isDomainHidden],
  );
  const visibleDomains = useMemo(
    () => annotatedDomains.filter((domain) => !domain.isHidden),
    [annotatedDomains],
  );
  const hiddenCount = annotatedDomains.length - visibleDomains.length;

  const portraitEntries = useMemo(
    () => (editMode ? annotatedDomains : visibleDomains).map(toPortraitEntry),
    [annotatedDomains, visibleDomains, editMode],
  );
  // One entry per declared interest — no fixed slot count and no cap. The manage
  // modal renders these plus a trailing "add interest" affordance, so the list
  // grows and shrinks with the player. (MAX_ACTIVE only bounds the write path.)
  const declaredSlots = useMemo<DomainMastery[]>(() => {
    if (!data) return [];
    const byKey = new Map(data.pageData.allDomains.map((domain) => [domainKey(domain.domain), domain]));
    return data.pageData.declaredInterests.map((domain) => byKey.get(domainKey(domain)) ?? emptyDomain(domain));
  }, [data]);
  const declaredKeys = useMemo(() => new Set((data?.pageData.declaredInterests ?? []).map(domainKey)), [data]);
  const demonstratedChoices = useMemo(() => {
    if (!data) return [];
    return data.pageData.allDomains
      .filter((domain) => (domain.isDemonstrated || domain.points > 0) && !declaredKeys.has(domainKey(domain.domain)))
      .sort((a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName));
  }, [data, declaredKeys]);

  const topCardDomains = useMemo(() => visibleDomains.filter((domain) => domain.points > 0).slice(0, 5), [visibleDomains]);
  const expandingDomains = data?.pageData.expandingDomains ?? [];
  const showShareNotice = (message: string) => {
    setQuestionToast(message);
    window.setTimeout(() => setQuestionToast(null), 2200);
  };
  const yourMind = data ? displayMind(visibleDomains, data.pageData.declaredInterests) : '';
  const displayName = 'You';
  const hasAnything = annotatedDomains.length > 0;

  const toggleDomainHidden = async (canonicalSubcategory: string, nextHidden: boolean) => {
    setHideError(null);
    setHidePending(canonicalSubcategory);
    setHiddenOverrides((current) => ({ ...current, [canonicalSubcategory]: nextHidden }));
    try {
      const response = await fetch(`/api/knowledge/${encodeURIComponent(canonicalSubcategory)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visibility: nextHidden ? 'private' : 'public' }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save that change.');
      }
    } catch (caught) {
      setHiddenOverrides((current) => {
        const next = { ...current };
        delete next[canonicalSubcategory];
        return next;
      });
      setHideError(caught instanceof Error ? caught.message : 'Could not save that change.');
      window.setTimeout(() => setHideError(null), 3200);
    } finally {
      setHidePending((current) => (current === canonicalSubcategory ? null : current));
    }
  };

  // openInterestModal is always triggered from within manage-interests, so closing returns there.
  const openInterestModal = (slotIndex: number, currentDomain: string | null) => {
    setActiveModal({ type: 'interests', slotIndex, currentDomain });
    setSelectedInterest(null);
    setCustomInterest('');
    setInterestChoices(null);
    setInterestError(null);
  };

  const closeInterestModal = () => {
    if (savingInterests) return;
    setActiveModal({ type: 'manage-interests' });
    setSelectedInterest(null);
    setCustomInterest('');
    setInterestChoices(null);
    setInterestError(null);
  };

  // Stage a written interest into the slot. A specific topic is selected as-is;
  // a too-broad one ("Music", "Technology") expands into specific choices the
  // player picks from instead, so a slot never gets a bucket-level label.
  const proposeCustomInterest = async () => {
    const raw = customInterest.trim();
    if (!raw) return;
    setCanonicalizing(true);
    setInterestError(null);
    setInterestChoices(null);
    try {
      if (isTooBroadInterest(raw)) {
        const response = await fetch('/api/interests/expand', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topic: raw }),
        });
        const body = await response.json().catch(() => null) as { candidates?: ProposedInterest[]; message?: string } | null;
        if (!response.ok) throw new Error(body?.message ?? 'Could not break that down.');
        const choices = Array.isArray(body?.candidates) ? body.candidates : [];
        if (choices.length === 0) {
          setInterestError(`“${raw}” is a whole category. Try something more specific — a person, era, scene, or work.`);
        } else {
          setSelectedInterest(null);
          setInterestChoices(choices);
        }
        return;
      }
      // Specific enough to stand on its own — now validate answerability up front
      // so a topic with no factual basis ("my cat") is caught before the confirm
      // step rather than silently producing nothing. The check fails open
      // server-side, so an LLM outage still lets the player proceed.
      const check = await fetch('/api/interests/check', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: raw }),
      });
      const checkBody = await check.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      if (check.ok && checkBody?.ok === false) {
        setInterestError(checkBody.message ?? 'We could not find real questions for that topic.');
        return;
      }
      setSelectedInterest({ label: raw });
    } catch (caught) {
      setInterestError(caught instanceof Error ? caught.message : 'Could not add that interest.');
    } finally {
      setCanonicalizing(false);
    }
  };

  const confirmInterestChange = async () => {
    if (activeModal?.type !== 'interests' || !selectedInterest?.label) return;
    // Backstop the "Use my wording" path: never let a bucket-level label save.
    if (isTooBroadInterest(selectedInterest.label)) {
      setInterestError(`“${selectedInterest.label.trim()}” is a whole category. Pick something more specific.`);
      return;
    }
    const modal = activeModal;
    setSavingInterests(true);
    setInterestError(null);
    // Full replace: start from the current declared list, then either swap the
    // chosen slot or append (slotIndex === declaredSlots.length signals an add).
    const entry: ProposedInterest = {
      label: selectedInterest.label.trim(),
      description: selectedInterest.description,
      broadCategory: selectedInterest.broadCategory,
    };
    const base: ProposedInterest[] = declaredSlots.map((slot) => ({
      label: slot.domain,
      broadCategory: slot.broadCategory,
    }));
    if (modal.slotIndex >= 0 && modal.slotIndex < base.length) {
      base[modal.slotIndex] = entry;
    } else {
      base.push(entry);
    }
    const nextInterests = base.filter((interest) => Boolean(interest.label.trim()));

    try {
      // PATCH /api/declared-interests is the full-replace endpoint
      // (saveDeclaredInterests). The old call hit /api/onboarding/save-interests
      // with PATCH, which has no PATCH handler — a 405 that silently failed.
      const response = await fetch('/api/declared-interests', {
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

  // Drop a declared interest via the same full-replace endpoint. Blocked at the
  // last one (the route also rejects an empty list) so a player always keeps at
  // least one interest seeding their Daily Five.
  const removeDeclaredInterest = async (domain: string) => {
    const remaining = declaredSlots
      .filter((slot) => slot.domain !== domain)
      .map((slot) => ({ label: slot.domain, broadCategory: slot.broadCategory }));
    if (remaining.length < 1) {
      setInterestError('Keep at least one interest — swap it instead of removing the last one.');
      return;
    }
    setSavingInterests(true);
    setInterestError(null);
    try {
      const response = await fetch('/api/declared-interests', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interests: remaining }),
      });
      const body = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? 'Could not remove that interest.');
      await loadKnowledge();
    } catch (caught) {
      setInterestError(caught instanceof Error ? caught.message : 'Could not remove that interest.');
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
    // Hold the modal open briefly so the form's in-form success state shows
    // before it closes; the toast above carries the destination detail.
    window.setTimeout(() => setActiveModal(null), SUCCESS_HOLD_MS);
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
      <main className="w-[min(672px,94vw)] mx-auto pt-5 pb-24 grid gap-3.5">
        <section className="bg-[var(--brand-card)] border border-[var(--border-warm)] p-4">
          <p className="m-0 text-[0.72rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Knowledge</p>
          <h1 className="mt-1.5 text-[clamp(1.1rem,2.5vw,1.55rem)] leading-[1.35] text-[var(--warm-ink)] font-[var(--font-neutral)] font-semibold">Could not load your map</h1>
          <p className="m-0 text-[var(--text-muted-warm)]">{error ?? 'Something went sideways.'}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="w-[min(672px,94vw)] mx-auto pt-5 pb-24 grid gap-3.5">
      <h1 className="m-0 px-1 font-serif text-[2rem] font-medium leading-tight text-[var(--brand-ink)]">
        Knowledge
      </h1>

      {tierCrossed && highlightedDomainSlug && (
        <section className="bg-[var(--cream-accent)] text-[var(--ink)] px-4 py-3 text-base">
          You reached {tierCrossed} in this domain this session.
        </section>
      )}

      {topCardDomains.length > 0 && (
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
          overflowCount={Math.max(0, visibleDomains.filter((domain) => domain.points > 0).length - topCardDomains.length)}
          tierSignature={`${formatNumber(data.mastery.totalPoints)} knowledge points across ${visibleDomains.length} territories`}
          rarestTerritory={null}
          rarestTerritorySolo={false}
          shareText={`My Joshing knowledge portrait: ${topCardDomains.map((domain) => domain.displayName).join(', ')}`}
          shareCardToken=""
          shareCardExpiresAt=""
          readOnly
          highlightedSlug={activeSlug}
          onShareClick={() => setShareModalOpen(true)}
        />
      )}

      <RecentlyExpanding domains={expandingDomains} playerDisplayName={displayName} onNotice={showShareNotice} />

      {hasAnything && (
        <section className="bg-[var(--brand-card)] border border-[var(--border-warm)] p-4" aria-label="Knowledge progression">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <p className="m-0 text-[13px] [font-variant:small-caps] text-[var(--ink)] font-[var(--font-neutral)] tracking-[0.06em]">YOUR KNOWLEDGE</p>
              <p className="mt-0.5 text-[10px] [font-variant:small-caps] text-[var(--text-muted-warm)] tracking-[0.06em] font-[var(--font-neutral)]">
                {editMode ? 'TAP A CIRCLE TO HIDE OR SHOW IT' : 'SEE HOW YOUR KNOWLEDGE IS BUILDING ->'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditMode((current) => !current)}
              className="shrink-0 min-h-8 border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--ink)] px-3 text-[0.7rem] uppercase tracking-[0.08em] cursor-pointer"
              aria-pressed={editMode}
            >
              {editMode ? 'Done' : 'Edit'}
            </button>
          </div>

          {editMode ? (
            <p className="m-0 mb-2 text-[0.78rem] text-[var(--text-muted-warm)] leading-[1.5]">
              Tap a circle to hide it from friends. Hidden circles stay visible to you here while editing.
            </p>
          ) : hiddenCount > 0 ? (
            <p className="m-0 mb-2 text-[0.78rem] text-[var(--text-muted-warm)]">
              {hiddenCount} hidden from friends —{' '}
              <button
                type="button"
                className="underline bg-transparent border-none p-0 text-[var(--text-muted-warm)] cursor-pointer"
                onClick={() => setEditMode(true)}
              >
                Edit to show
              </button>
            </p>
          ) : null}

          <div id="portrait-circles-section">
            <PortraitCircles
              entries={portraitEntries}
              editMode={editMode}
              onToggleHidden={(canonical, nextHidden) => void toggleDomainHidden(canonical, nextHidden)}
              pendingDomain={hidePending}
            />
            {hideError ? (
              <p className="mt-3 text-[0.78rem] text-[var(--cat-literature-text)] border border-[var(--cat-literature)]/40 p-2">{hideError}</p>
            ) : null}
          </div>
        </section>
      )}

      {emptyQuestionDomain ? (
        <section className="bg-[color-mix(in_srgb,var(--accent-gold)_8%,var(--brand-card))] border border-[color-mix(in_srgb,var(--accent-gold)_55%,var(--brand-border))] px-4 py-5" aria-label={`No ${emptyQuestionDomain} questions yet`}>
          <p className="m-0 text-[13px] [font-variant:small-caps] text-[var(--ink)] font-[var(--font-neutral)] tracking-[0.06em]">No matching public questions</p>
          <h2 className="mt-1.5 text-xl leading-[1.35] text-[var(--ink)] font-[var(--font-serif)] font-semibold">We don&apos;t have {emptyQuestionDomain} questions yet. Want to ask someone who might?</h2>
          <p className="mt-3 text-[0.88rem] leading-[1.6] text-[var(--text-muted-warm)]">Josh is going deep on {emptyQuestionDomain} — and thinks someone in your world might be the one to stump them.</p>
          <div className="flex flex-wrap gap-2.5 mt-5">
            <button type="button" className="min-h-10 border border-[var(--ink)] bg-[var(--ink)] text-[var(--cream-warm)] px-4 cursor-pointer text-[0.82rem] font-[inherit]" onClick={() => setAskFriendDomain(emptyQuestionDomain)}>
              Ask a friend
            </button>
            <button type="button" className="min-h-10 border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--ink)] px-4 cursor-pointer text-[0.82rem] font-[inherit]" onClick={() => setActiveModal({ type: 'write-question' })}>
              Write one myself
            </button>
          </div>
        </section>
      ) : null}

      {dismissedDomains.length > 0 && (
        <section id="focused-feed" className="bg-[var(--brand-card)] border border-[var(--border-warm)] p-4 scroll-mt-4" aria-label="Hidden areas">
          <p className="m-0 text-[13px] [font-variant:small-caps] text-[var(--ink)] font-[var(--font-neutral)] tracking-[0.06em]">HIDDEN AREAS</p>
          <p className="mt-0.5 text-[10px] [font-variant:small-caps] text-[var(--text-muted-warm)] tracking-[0.06em] font-[var(--font-neutral)]">DOMAINS YOU&rsquo;VE HIDDEN FROM YOUR FEED — UN-HIDE ANY TIME</p>
          <div className="mt-3 flex flex-col gap-2">
            {dismissedDomains.map((domain) => (
              <div key={domain} className="flex items-center justify-between gap-2">
                <span className="text-sm">{domain}</span>
                <button
                  type="button"
                  className="border-none bg-transparent text-[var(--text-muted-warm)] underline cursor-pointer p-0 text-[0.76rem] uppercase tracking-[0.08em]"
                  onClick={() => void reinstateDomain(domain)}
                  disabled={reinstating === domain}
                  aria-label={`Un-hide ${domain} in your feed`}
                >
                  {reinstating === domain ? 'Un-hiding…' : 'Un-hide'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex items-center justify-between gap-4 border-t border-[var(--border-warm)] pt-3.5 px-1">
        <p className="m-0 text-[var(--text-muted-warm)]">Map maintenance</p>
        <button type="button" className="min-h-9 border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--ink)] inline-flex items-center justify-center gap-2 px-3 text-[0.7rem] uppercase tracking-[0.08em] cursor-pointer" onClick={() => setActiveModal({ type: 'tidy' })} disabled={tidying}>
          <Combine className="size-3.5" />
          Tidy up my map
        </button>
      </section>

      {shareModalOpen && (
        <SharePortraitModal
          playerDisplayName={displayName}
          portraitStatement={yourMind}
          domains={topCardDomains.map((domain) => ({
            canonicalSubcategory: domain.displayName,
            currentTier: asTier(domain.tier),
            lifetimePoints: domain.points,
            iconKey: domain.iconKey,
            broadCategory: domain.broadCategory,
          }))}
          overflowCount={Math.max(0, visibleDomains.filter((domain) => domain.points > 0).length - topCardDomains.length)}
          tierSignature={`${formatNumber(data.mastery.totalPoints)} knowledge points across ${visibleDomains.length} territories`}
          onClose={() => setShareModalOpen(false)}
        />
      )}

      {askFriendDomain ? (
        <AskFriendForDomain key={askFriendDomain} domain={askFriendDomain} onClose={() => setAskFriendDomain(null)} />
      ) : null}

      {activeModal?.type === 'interests' ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 p-4">
          <div className="w-[min(540px,100%)] max-h-[90vh] overflow-y-auto bg-[var(--brand-card)] border border-[var(--border-warm)] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
            <div className="flex justify-between gap-4">
              <div>
                <h2 className="m-0 text-[var(--ink)] text-[1.45rem] font-[var(--font-serif)]">{activeModal.currentDomain ? `Swap ${activeModal.currentDomain}` : 'Add to your declared interests'}</h2>
                {activeModal.currentDomain ? (
                  <p className="mt-2 text-[var(--text-muted-warm)] text-[0.88rem] leading-[1.5]">Your progress in {activeModal.currentDomain} is preserved. It moves to your demonstrated knowledge.</p>
                ) : null}
              </div>
              <button type="button" className="w-[34px] h-[34px] border-none bg-transparent text-[var(--text-muted-warm)] grid place-items-center cursor-pointer" onClick={closeInterestModal} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            <div className="grid gap-5 mt-5">
              <div>
                <h3 className="m-0 text-[var(--ink)] text-[0.9rem]">Pick from your knowledge base</h3>
                {demonstratedChoices.length === 0 ? (
                  <p className="mt-2 border border-[var(--border-light)] p-3 text-[var(--text-muted-warm)] text-[0.88rem]">No demonstrated domains are available to add right now.</p>
                ) : (
                  <div className="mt-2 max-h-[176px] overflow-y-auto border border-[var(--border-light)]">
                    {demonstratedChoices.map((domain) => (
                      <button
                        key={domain.domain}
                        type="button"
                        className={`w-full min-h-[38px] border-0 border-b border-b-[var(--border-light)] flex justify-between gap-3 px-3 cursor-pointer ${selectedInterest?.label === domain.domain ? 'bg-[var(--cream-warm)] text-[var(--ink)]' : 'bg-[var(--brand-card)] text-[var(--text-muted-warm)]'}`}
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
                <h3 className="m-0 text-[var(--ink)] text-[0.9rem]">Write a new interest</h3>
                <div className="flex gap-2 mt-2">
                  <input
                    value={customInterest}
                    onChange={(event) => setCustomInterest(event.target.value)}
                    placeholder="Late-period Bowie, Weimar cinema..."
                    className="min-h-10 flex-1 border border-[var(--accent-gold)] focus:border-[var(--brand-navy)] outline-none px-2.5 bg-[var(--brand-field)] text-[var(--ink)]"
                  />
                  <button type="button" className="min-h-10 border border-[var(--ink)] bg-[var(--ink)] text-[var(--cream-warm)] px-4 cursor-pointer" disabled={!customInterest.trim() || canonicalizing} onClick={() => void proposeCustomInterest()}>
                    {canonicalizing ? 'Refining...' : 'Refine'}
                  </button>
                </div>
                {interestChoices ? (
                  <div className="mt-3">
                    <p className="m-0 text-[var(--text-muted-warm)] text-[0.82rem]">That&rsquo;s a whole category — pick what you&rsquo;re into:</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {interestChoices.map((choice) => (
                        <button
                          key={choice.label}
                          type="button"
                          className="border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--ink)] px-3 py-1.5 text-[0.82rem] cursor-pointer hover:bg-[var(--cream-warm)]"
                          onClick={() => {
                            setSelectedInterest({ label: choice.label, broadCategory: choice.broadCategory ?? undefined });
                            setInterestChoices(null);
                          }}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {selectedInterest ? (
                  <div className="mt-3 border border-[var(--border-light)] bg-[var(--cream)] p-3">
                    <p className="m-0 font-semibold">{selectedInterest.label}</p>
                    {selectedInterest.description ? <p className="mt-2 text-[var(--text-muted-warm)] text-[0.88rem] leading-[1.5]">{selectedInterest.description}</p> : null}
                    <button type="button" className="mt-2 border-none bg-transparent text-[var(--text-muted-warm)] underline cursor-pointer p-0 text-[0.76rem] uppercase tracking-[0.08em]" onClick={() => setSelectedInterest({ label: customInterest.trim() || selectedInterest.label })}>
                      Use my wording
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {interestError ? <p className="mt-4 border border-[var(--cat-literature)]/40 text-[var(--cat-literature-text)] p-3 text-[0.88rem]">{interestError}</p> : null}

            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="min-h-10 border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--text-muted-warm)] px-4 cursor-pointer" onClick={closeInterestModal} disabled={savingInterests}>Cancel</button>
              <button type="button" className="min-h-10 border border-[var(--ink)] bg-[var(--ink)] text-[var(--cream-warm)] px-4 cursor-pointer" onClick={() => void confirmInterestChange()} disabled={!selectedInterest?.label || savingInterests}>
                {savingInterests ? 'Saving...' : activeModal.currentDomain ? 'Confirm swap' : 'Confirm add'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal?.type === 'tidy' ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 p-4">
          <div className="w-[min(430px,100%)] max-h-[90vh] overflow-y-auto bg-[var(--brand-card)] border border-[var(--border-warm)] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
            <div className="flex justify-between gap-4">
              <div>
                <h2 className="m-0 text-[var(--ink)] text-[1.45rem] font-[var(--font-serif)]">Tidy up your map?</h2>
                <p className="mt-2 text-[var(--text-muted-warm)] text-[0.88rem] leading-[1.5]">We&apos;ll look for domains in your map that could be combined. This is automatic and based on what you&apos;ve answered.</p>
              </div>
              <button type="button" className="w-[34px] h-[34px] border-none bg-transparent text-[var(--text-muted-warm)] grid place-items-center cursor-pointer" onClick={() => setActiveModal(null)} aria-label="Close" disabled={tidying}>
                <X className="size-4" />
              </button>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="min-h-10 border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--text-muted-warm)] px-4 cursor-pointer" onClick={() => setActiveModal(null)} disabled={tidying}>Cancel</button>
              <button type="button" className="min-h-10 border border-[var(--ink)] bg-[var(--ink)] text-[var(--cream-warm)] px-4 cursor-pointer" onClick={() => void confirmTidy()} disabled={tidying}>
                {tidying ? 'Tidying...' : 'Confirm tidy'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tidyNotice ? <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--ink)] px-4 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.16)] text-[0.88rem]">{tidyNotice}</div> : null}
      {questionToast ? (
        <div
          style={{ bottom: tidyNotice ? 64 : 20 }}
          className="fixed left-1/2 -translate-x-1/2 z-[60] border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--ink)] px-4 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.16)] text-[0.88rem]"
        >
          {questionToast}
        </div>
      ) : null}

      {activeModal?.type === 'manage-interests' ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 p-4">
          <div className="w-[min(540px,100%)] max-h-[90vh] overflow-y-auto bg-[var(--brand-card)] border border-[var(--border-warm)] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
            <div className="flex justify-between gap-4">
              <div>
                <h2 className="m-0 text-[var(--ink)] text-[1.45rem] font-[var(--font-serif)]">Manage interests</h2>
                <p className="mt-2 text-[var(--text-muted-warm)] text-[0.88rem] leading-[1.5]">Your declared interests seed your Daily Five questions. Add as many as you like.</p>
              </div>
              <button type="button" className="w-[34px] h-[34px] border-none bg-transparent text-[var(--text-muted-warm)] grid place-items-center cursor-pointer" onClick={() => setActiveModal(null)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-2.5 mt-5">
              {declaredSlots.map((slot, index) => (
                <div key={slot.domain} className="min-h-[132px] border border-[var(--border-light)] rounded-lg p-3 flex flex-col justify-between bg-[var(--cream)]">
                  <div className="min-w-0">
                    <h3 className="m-0 text-[0.9rem] leading-[1.25] text-[var(--ink)]">{slot.displayName}</h3>
                    <p className="mt-1 text-[var(--text-muted-warm)] text-[0.72rem]">{slot.broadCategory ?? asTier(slot.tier)}</p>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <button type="button" className="flex-1 min-h-[34px] border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--text-muted-warm)] inline-flex items-center justify-center gap-1.5 text-[0.68rem] uppercase tracking-[0.08em] cursor-pointer" onClick={() => openInterestModal(index, slot.domain)}>
                      <Repeat2 className="size-3.5" />
                      Swap
                    </button>
                    <button type="button" className="min-h-[34px] w-[34px] border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--text-muted-warm)] inline-flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => void removeDeclaredInterest(slot.domain)} disabled={savingInterests || declaredSlots.length <= 1} aria-label={`Remove ${slot.displayName}`} title={declaredSlots.length <= 1 ? 'Keep at least one interest' : `Remove ${slot.displayName}`}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="min-h-[132px] border border-[var(--border-light)] rounded-lg p-3 flex flex-col justify-between bg-[var(--cream)]">
                <button type="button" className="min-h-[104px] border border-dashed border-[#c8c0b0] bg-transparent text-[var(--text-muted-warm)] flex flex-col items-center justify-center gap-2 text-[0.82rem] cursor-pointer w-full h-full" onClick={() => openInterestModal(declaredSlots.length, null)}>
                  <Plus className="size-4" />
                  Add interest
                </button>
              </div>
            </div>
            <div className="flex justify-start gap-2 mt-4">
              <button type="button" className="min-h-10 border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--text-muted-warm)] px-4 cursor-pointer" onClick={() => setActiveModal(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal?.type === 'write-question' ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 p-4">
          <div className="w-[min(540px,100%)] max-h-[92vh] overflow-y-auto bg-[var(--brand-card)] border border-[var(--border-warm)] px-5 pt-5 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
            <div className="flex justify-between gap-4">
              <h2 className="m-0 text-[var(--ink)] text-[1.45rem] font-[var(--font-serif)]">Write a question</h2>
              <button type="button" className="w-[34px] h-[34px] border-none bg-transparent text-[var(--text-muted-warm)] grid place-items-center cursor-pointer" onClick={() => setActiveModal(null)} aria-label="Close">
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
