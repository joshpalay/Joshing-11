'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Combine, Plus, Trash2, X } from 'lucide-react';
import { QuestionForm, type QuestionFormValues } from '@/components/QuestionForm';
import { Skeleton } from '@/components/ui/Skeleton';

import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard';
import { PortraitCircles, type PortraitEntry } from '@/components/knowledge/PortraitCircles';
import { SharePortraitCard } from '@/components/knowledge/SharePortraitCard';
import { SharePortraitModal } from '@/components/knowledge/SharePortraitModal';
import { useSharePortraitCapture } from '@/components/knowledge/useSharePortraitCapture';
import { RecentlyExpanding, type ExpandingDomain } from '@/components/knowledge/RecentlyExpanding';
import { AskFriendForDomain } from '@/components/knowledge/AskFriendForDomain';
import { PeakDetailCard, type LeafInfo } from '@/components/knowledge/KnowledgePeaksView';
import { usePeakDetail, freqKey } from '@/components/knowledge/usePeakDetail';
import { toCanonicalDomainSlug } from '@/server/profile/domain-slug';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';
import { isTooBroadInterest } from '@/lib/knowledge/interest-specificity';
import { domainKey } from '@/lib/knowledge/domain-key';
import {
  TERRITORY_FREQUENCY_LABEL,
  getNearbyTerritories,
  type DomainPreferenceFrequency,
  type NearbyTerritory,
} from '@/lib/daily/territory-model';
import { GhostTerritoryCircle } from '@/components/knowledge/GhostTerritoryCircle';
import type { KnowledgeTreeNode } from '@/server/knowledge/knowledge-tree';
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

// Detail-pop-up inputs threaded from the server (page.tsx). The flat portrait
// itself still loads from /api/knowledge client-side; these ride alongside so a
// tapped circle can open the same PeakDetailCard the "peaks" view uses.
type PeaksDetailData = {
  tree: KnowledgeTreeNode;
  frequencyByDomain: DomainPreferenceFrequency;
  fullyExploredDomains: ReadonlySet<string>;
};

type TreeIndex = { byId: Map<string, LeafInfo>; byFreqKey: Map<string, LeafInfo> };

function isOwnedTreeLeaf(node: KnowledgeTreeNode): boolean {
  return !node.ghost && (node.value ?? 0) > 0 && (!node.children || node.children.length === 0);
}

// One walk of the tree → every non-root node as a LeafInfo (with its lineage),
// indexed by id (for sibling/child jumps) and by normalized name (for resolving
// a tapped portrait circle). Top-level nodes get parent/topParent = null, exactly
// like KnowledgePeaksView's `areas`, so the detail card's "More in…" reads right.
// When a name collides, an owned terminal leaf wins over a container/ghost.
function indexTree(tree: KnowledgeTreeNode): TreeIndex {
  const byId = new Map<string, LeafInfo>();
  const byFreqKey = new Map<string, LeafInfo>();
  const walk = (node: KnowledgeTreeNode, ancestors: KnowledgeTreeNode[]) => {
    if (ancestors.length > 0) {
      const topLevel = ancestors.length === 1; // only the synthetic root above it
      const path = topLevel ? [] : ancestors.slice(1);
      const info: LeafInfo = {
        node,
        path,
        parent: topLevel ? null : ancestors.at(-1) ?? null,
        topParent: path[0] ?? null,
      };
      byId.set(node.id, info);
      const key = freqKey(node.name);
      const existing = byFreqKey.get(key);
      if (!existing || (isOwnedTreeLeaf(node) && !isOwnedTreeLeaf(existing.node))) {
        byFreqKey.set(key, info);
      }
    }
    for (const child of node.children ?? []) walk(child, [...ancestors, node]);
  };
  walk(tree, []);
  return { byId, byFreqKey };
}

// A portrait domain with no matching tree node still gets a pop-up: a bare leaf
// (no lineage, no siblings) so the identity header and frequency editor work.
function synthesizeLeaf(domain: DomainMastery): LeafInfo {
  return {
    node: {
      id: `flat:${domain.domain}`,
      name: domain.displayName,
      field: null,
      value: domain.points,
      mastered: domain.tier === 'mastery',
    },
    path: [],
    parent: null,
    topParent: null,
  };
}

function LoadingSkeleton() {
  return (
    <main className="w-[min(672px,94vw)] mx-auto pt-5 pb-10 grid gap-3.5">
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

export function KnowledgeFlatClient(props: PeaksDetailData) {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <KnowledgePageContent {...props} />
    </Suspense>
  );
}

function KnowledgePageContent({ tree, frequencyByDomain, fullyExploredDomains }: PeaksDetailData) {
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
  const [questionToast, setQuestionToast] = useState<string | null>(null);
  const [askFriendDomain, setAskFriendDomain] = useState<string | null>(null);

  // Detail pop-up controller (shared with the peaks view): owns the optimistic
  // tree + rotation map and the frequency/adopt writes. `selectedLeaf` is the
  // tapped circle resolved to a tree leaf (or a synthesized bare leaf).
  const { tree: detailTree, resolveFrequency, setFrequency, adoptNode } = usePeakDetail(
    tree,
    frequencyByDomain,
  );
  const [selectedLeaf, setSelectedLeaf] = useState<LeafInfo | null>(null);
  const treeIndex = useMemo(() => indexTree(detailTree), [detailTree]);
  const fullyExploredKeys = useMemo(() => {
    const set = new Set<string>();
    for (const domain of fullyExploredDomains) set.add(freqKey(domain));
    return set;
  }, [fullyExploredDomains]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial page hydration is fetched client-side for this route.
    loadKnowledge()
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

  // Non-hidden domains feed the portrait and every public-facing surface (the
  // share card, the "your mind" line, the point/territory signature). A domain
  // set to private drops out here; that visibility is now managed per-domain on
  // its detail page, not by an edit mode on this portrait.
  const visibleDomains = useMemo(
    () => sortedDomains.filter((domain) => !domain.isHidden),
    [sortedDomains],
  );

  // Rotation word shown under every circle's name — resolves through the same
  // frequency map that seeds the detail pop-up, so face and sheet always agree.
  const frequencyLabelFor = (canonicalSubcategory: string): string =>
    TERRITORY_FREQUENCY_LABEL[resolveFrequency(canonicalSubcategory)];

  // "Remove from your map" (detail pop-up, confirmed): writes a subcategory
  // exclusion — the same removal the retired Configure page performed — then
  // drops the circle optimistically and refreshes from the server, which now
  // filters excluded domains out of the knowledge read.
  const removeFromMap = async (canonicalSubcategory: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/users/domain-exclusions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonical_subcategory: canonicalSubcategory, scope: 'subcategory' }),
      });
      if (!response.ok) return false;
    } catch {
      return false;
    }
    const removedKey = freqKey(canonicalSubcategory);
    setSelectedLeaf(null);
    setData((previous) =>
      previous
        ? {
            ...previous,
            pageData: {
              ...previous.pageData,
              allDomains: previous.pageData.allDomains.filter(
                (domain) => freqKey(domain.displayName) !== removedKey,
              ),
            },
          }
        : previous,
    );
    void loadKnowledge().catch(() => undefined);
    return true;
  };

  // "Add a Territory" — ported from the retired Configure page. Suggestions
  // come from the deterministic nearby-territory rules over the domains
  // already held; the offset rotates the visible window per visit (set in a
  // deferred frame, client-only, so SSR markup never disagrees).
  const [suggestionOffset, setSuggestionOffset] = useState(0);
  const [addingSuggestion, setAddingSuggestion] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      setSuggestionOffset(Math.floor(Math.random() * 1000)),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const nearbySuggestions = useMemo(
    () => getNearbyTerritories(sortedDomains.map((domain) => domain.displayName)),
    [sortedDomains],
  );
  const visibleNearby = useMemo(() => {
    const SHOWN = 3;
    if (nearbySuggestions.length <= SHOWN) return nearbySuggestions;
    const start = suggestionOffset % nearbySuggestions.length;
    return [...nearbySuggestions.slice(start), ...nearbySuggestions.slice(0, start)].slice(0, SHOWN);
  }, [nearbySuggestions, suggestionOffset]);

  const addSuggestion = async (territory: NearbyTerritory) => {
    if (addingSuggestion) return;
    setAddingSuggestion(territory.domain);
    setSuggestError(null);
    try {
      const response = await fetch('/api/declared-interests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: territory.domain,
          ...(territory.broadCategory ? { broadCategory: territory.broadCategory } : {}),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not add that territory.');
      }
      await loadKnowledge();
    } catch (caught) {
      setSuggestError(caught instanceof Error ? caught.message : 'Could not add that territory.');
    } finally {
      setAddingSuggestion(null);
    }
  };

  // A tapped circle (outside edit mode) opens the peaks detail pop-up. Prefer the
  // real tree leaf; fall back to a synthesized bare leaf for a domain the tree
  // doesn't carry, so the frequency editor still works everywhere.
  const openDomainDetail = (canonicalSubcategory: string) => {
    const key = freqKey(canonicalSubcategory);
    const fromTree = treeIndex.byFreqKey.get(key);
    if (fromTree) {
      setSelectedLeaf(fromTree);
      return;
    }
    const domain = sortedDomains.find((entry) => freqKey(entry.displayName) === key);
    setSelectedLeaf(domain ? synthesizeLeaf(domain) : null);
  };

  const portraitEntries = useMemo(
    () => visibleDomains.map(toPortraitEntry),
    [visibleDomains],
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
  const hasAnything = sortedDomains.length > 0;

  // Share payload for the Knowledge Portrait card, shared by the off-screen
  // capture card, the direct-share handler, and the modal fallback.
  const shareDomains = useMemo(
    () =>
      topCardDomains.map((domain) => ({
        canonicalSubcategory: domain.displayName,
        currentTier: asTier(domain.tier),
        lifetimePoints: domain.points,
        iconKey: domain.iconKey,
        broadCategory: domain.broadCategory,
      })),
    [topCardDomains],
  );
  const shareOverflowCount = Math.max(
    0,
    visibleDomains.filter((domain) => domain.points > 0).length - topCardDomains.length,
  );
  const shareTierSignature = data
    ? `${formatNumber(data.mastery.totalPoints)} knowledge points across ${visibleDomains.length} territories`
    : '';

  // Pre-capture the portrait image in the background so the card's Share button
  // can hand it straight to the native share sheet — no intermediate preview.
  const { cardRef: portraitCardRef, shareNow: sharePortraitNow } = useSharePortraitCapture(
    topCardDomains.length > 0,
  );
  const handlePortraitShare = () => {
    // Common case: the image is ready, so share it directly. If the user taps
    // before the background capture finishes, fall back to the preview modal
    // (which captures on its own mount) rather than failing silently.
    if (!sharePortraitNow()) setShareModalOpen(true);
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
      <main className="w-[min(672px,94vw)] mx-auto pt-5 pb-10 grid gap-3.5">
        <section className="bg-[var(--brand-card)] border border-[var(--border-warm)] p-4">
          <p className="m-0 text-[0.72rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Knowledge</p>
          <h1 className="mt-1.5 text-[clamp(1.1rem,2.5vw,1.55rem)] leading-[1.35] text-[var(--warm-ink)] font-[var(--font-neutral)] font-semibold">Could not load your map</h1>
          <p className="m-0 text-[var(--text-muted-warm)]">{error ?? 'Something went sideways.'}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="w-[min(672px,94vw)] mx-auto pt-5 pb-10 grid gap-3.5">
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
          overflowCount={shareOverflowCount}
          tierSignature={shareTierSignature}
          rarestTerritory={null}
          rarestTerritorySolo={false}
          shareText={`My Joshing knowledge portrait: ${topCardDomains.map((domain) => domain.displayName).join(', ')}`}
          shareCardToken=""
          shareCardExpiresAt=""
          readOnly
          highlightedSlug={activeSlug}
          onShareClick={handlePortraitShare}
        />
      )}

      <RecentlyExpanding domains={expandingDomains} playerDisplayName={displayName} onNotice={showShareNotice} />

      {hasAnything && (
        <section className="bg-[var(--brand-card)] border border-[var(--border-warm)] p-4" aria-label="Knowledge progression">
          <div className="mb-2">
            <p className="m-0 text-[13px] [font-variant:small-caps] text-[var(--ink)] font-[var(--font-neutral)] tracking-[0.06em]">YOUR KNOWLEDGE</p>
            <p className="mt-0.5 text-[10px] [font-variant:small-caps] text-[var(--text-muted-warm)] tracking-[0.06em] font-[var(--font-neutral)]">
              SEE HOW YOUR KNOWLEDGE IS BUILDING -&gt;
            </p>
          </div>

          <div id="portrait-circles-section">
            <PortraitCircles
              entries={portraitEntries}
              frequencyLabelFor={frequencyLabelFor}
              onSelectDomain={openDomainDetail}
            />
          </div>

          {/* Add a Territory — ported from the retired Configure page: nearby
              suggestions from the shape of the map plus the create-your-own
              flow (the existing declared-interests modal). */}
          <div className="mt-6 border-t border-[var(--border-warm)] pt-4">
            <h3 className="m-0 text-lg font-semibold text-[var(--ink)] font-[var(--font-serif)]">Add a territory</h3>
            <p className="mt-1 mb-3 text-[0.82rem] leading-[1.5] text-[var(--text-muted-warm)]">
              {visibleNearby.length > 0
                ? 'Suggestions based on the shape of your map — or create your own.'
                : 'Create your own, and more suggestions will appear as your map grows.'}
            </p>
            <Link href="/daily/setup" className="btn-ghost gap-1.5">
              <Plus className="size-4" aria-hidden /> Create your own
            </Link>
            {visibleNearby.length > 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {visibleNearby.map((territory) => (
                  <GhostTerritoryCircle
                    key={territory.domain}
                    territory={territory}
                    disabled={addingSuggestion !== null}
                    onAdd={() => void addSuggestion(territory)}
                  />
                ))}
              </div>
            ) : null}
            {suggestError ? (
              <p className="mt-2 text-[0.78rem]" style={{ color: 'var(--game-wrong-strong)' }}>{suggestError}</p>
            ) : null}
          </div>
        </section>
      )}

      {/* First-territory moment — the retired Configure page's empty state,
          now living where the map does. */}
      {!hasAnything && (
        <section
          className="bg-[var(--brand-card)] border border-dashed border-[var(--border-warm)] p-6 text-center"
          aria-label="Add your first territory"
        >
          <h2 className="m-0 font-[var(--font-serif)] text-2xl font-semibold text-[var(--ink)]">
            Your map is ready for its first territory.
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-[0.88rem] leading-[1.6] text-[var(--text-muted-warm)]">
            Add something you&rsquo;d be delighted to be asked about, and Joshing will start shaping
            around it.
          </p>
          <Link href="/daily/setup" className="btn-primary mx-auto mt-4 gap-1.5">
            <Plus className="size-5" aria-hidden /> Create your own
          </Link>
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

      <section className="flex items-center justify-between gap-4 border-t border-[var(--border-warm)] pt-3.5 px-1">
        <p className="m-0 text-[var(--text-muted-warm)]">Map maintenance</p>
        <button type="button" className="min-h-9 border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--ink)] inline-flex items-center justify-center gap-2 px-3 text-[0.7rem] uppercase tracking-[0.08em] cursor-pointer" onClick={() => setActiveModal({ type: 'tidy' })} disabled={tidying}>
          <Combine className="size-3.5" />
          Tidy up my map
        </button>
      </section>

      {/* Off-screen portrait card, snapshotted in the background so the card's
          Share button can fire the native share sheet without a preview step. */}
      {topCardDomains.length > 0 ? (
        <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
          <SharePortraitCard
            ref={portraitCardRef}
            playerDisplayName={displayName}
            portraitStatement={yourMind}
            domains={shareDomains}
            overflowCount={shareOverflowCount}
            tierSignature={shareTierSignature}
          />
        </div>
      ) : null}

      {shareModalOpen && (
        <SharePortraitModal
          playerDisplayName={displayName}
          portraitStatement={yourMind}
          domains={shareDomains}
          overflowCount={shareOverflowCount}
          tierSignature={shareTierSignature}
          onClose={() => setShareModalOpen(false)}
        />
      )}

      {askFriendDomain ? (
        <AskFriendForDomain key={askFriendDomain} domain={askFriendDomain} onClose={() => setAskFriendDomain(null)} />
      ) : null}

      {activeModal?.type === 'interests' ? (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--scrim)] p-4">
          <div className="w-[min(540px,100%)] max-h-[90vh] overflow-y-auto bg-[var(--brand-card)] border border-[var(--border-warm)] p-5 shadow-[var(--shadow-overlay)]">
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
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--scrim)] p-4">
          <div className="w-[min(430px,100%)] max-h-[90vh] overflow-y-auto bg-[var(--brand-card)] border border-[var(--border-warm)] p-5 shadow-[var(--shadow-overlay)]">
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

      {tidyNotice ? <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[var(--z-toast)] border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--ink)] px-4 py-2.5 shadow-[var(--shadow-overlay)] text-[0.88rem]">{tidyNotice}</div> : null}
      {questionToast ? (
        <div
          style={{ bottom: tidyNotice ? 64 : 20 }}
          className="fixed left-1/2 -translate-x-1/2 z-[var(--z-toast)] border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--ink)] px-4 py-2.5 shadow-[var(--shadow-overlay)] text-[0.88rem]"
        >
          {questionToast}
        </div>
      ) : null}

      {activeModal?.type === 'manage-interests' ? (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--scrim)] p-4">
          <div className="w-[min(540px,100%)] max-h-[90vh] overflow-y-auto bg-[var(--brand-card)] border border-[var(--border-warm)] p-5 shadow-[var(--shadow-overlay)]">
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
              {declaredSlots.map((slot) => (
                <div key={slot.domain} className="min-h-[132px] border border-[var(--border-light)] rounded-lg p-3 flex flex-col justify-between bg-[var(--cream)]">
                  <div className="min-w-0">
                    <h3 className="m-0 text-[0.9rem] leading-[1.25] text-[var(--ink)]">{slot.displayName}</h3>
                    <p className="mt-1 text-[var(--text-muted-warm)] text-[0.72rem]">{slot.broadCategory ?? asTier(slot.tier)}</p>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <button type="button" className="flex-1 min-h-[34px] border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--text-muted-warm)] inline-flex items-center justify-center gap-1.5 text-[0.68rem] uppercase tracking-[0.08em] cursor-pointer" onClick={() => openInterestModal(declaredSlots.length, null)}>
                      <Plus className="size-3.5" />
                      Add
                    </button>
                    <button type="button" className="min-h-[34px] w-[34px] border border-[var(--border-warm)] bg-[var(--brand-card)] text-[var(--text-muted-warm)] inline-flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => void removeDeclaredInterest(slot.domain)} disabled={savingInterests || declaredSlots.length <= 1} aria-label={`Remove ${slot.displayName}`} title={declaredSlots.length <= 1 ? 'Keep at least one interest' : `Remove ${slot.displayName}`}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="min-h-[132px] border border-[var(--border-light)] rounded-lg p-3 flex flex-col justify-between bg-[var(--cream)]">
                <button type="button" className="min-h-[104px] border border-dashed border-[var(--warm-border-soft)] bg-transparent text-[var(--text-muted-warm)] flex flex-col items-center justify-center gap-2 text-[0.82rem] cursor-pointer w-full h-full" onClick={() => openInterestModal(declaredSlots.length, null)}>
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
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--scrim)] p-4">
          <div className="w-[min(540px,100%)] max-h-[92vh] overflow-y-auto bg-[var(--brand-card)] border border-[var(--border-warm)] px-5 pt-5 shadow-[var(--shadow-overlay)]">
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

      {/* Domain detail pop-up — the same PeakDetailCard the "peaks" view uses,
          opened by tapping a circle. Backdrop tap closes; the card owns its X. */}
      {selectedLeaf ? (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-[var(--scrim)] p-4 sm:items-center"
          onClick={() => setSelectedLeaf(null)}
        >
          <div className="w-[min(480px,100%)]" onClick={(event) => event.stopPropagation()}>
            <PeakDetailCard
              key={selectedLeaf.node.id}
              leaf={selectedLeaf}
              variant="own"
              frequency={resolveFrequency(selectedLeaf.node.name)}
              fullyExplored={fullyExploredKeys.has(freqKey(selectedLeaf.node.name))}
              adopted={false}
              onClose={() => setSelectedLeaf(null)}
              onSelectSibling={(id) => {
                const info = treeIndex.byId.get(id);
                if (info) setSelectedLeaf(info);
              }}
              onAdd={adoptNode}
              onSetFrequency={setFrequency}
              onRemove={removeFromMap}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
