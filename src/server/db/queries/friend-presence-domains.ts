/**
 * Daily Five +2 domain pool (D-4 §B, A-2 ranking rule).
 *
 * The +2 reframe: instead of replaying a friend's literal answered question, the
 * bonus serves a FRESHLY GENERATED accessible question in a domain drawn from the
 * territory ∪ activity of the people the viewer follows. This module produces the
 * ranked domain pool; generation + slot-building live in generate-questions.ts /
 * daily.ts / the queue orchestrator.
 *
 * Two signals per followed friend, both already rendered on their profile:
 *  - Territory: their durable knowledge map — declared + demonstrated domains.
 *  - Activity:  their recently-active domains (masteryEvents recency, via
 *               selectRecentlyExploring).
 *
 * A domain merged across friends is tagged Both / territory-only / activity-only
 * and ranked Both > territory-only > activity-only, tie-broken by recency then
 * strength (strength is a tie-breaker, NOT a gate — a lightly-held but genuine
 * territory domain is still eligible).
 */

import { getKnowledgePageDataForUsers, type DomainMastery } from '@/server/db/queries/knowledge';
import { getFollowing, getMutualFollows } from '@/server/db/queries/friends';
import { selectRecentlyExploring } from '@/server/profile/recently-exploring';
import {
  canViewSection,
  getSectionVisibilitiesBulk,
  type EffectiveViewer,
} from '@/server/profile/visibility';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';

export type FriendDomainSignal = 'both' | 'territory' | 'activity';

// One friend's contribution of a single domain — the raw input to the pure
// ranker. inTerritory/inActivity come from that friend's map; the merge across
// friends happens in rankFriendDomainsForBonus.
export type FriendDomainContribution = {
  friendId: string;
  friendDisplayName: string | null;
  domain: string;
  broadCategory: string | null;
  inTerritory: boolean;
  inActivity: boolean;
  /** Most recent masteryEvents activity in this domain for this friend (ms epoch), or null. */
  lastActivityAt: number | null;
  /** Mastery points — strength tie-breaker only, never a gate. */
  strength: number;
};

export type PresenceSource = {
  userId: string;
  displayName: string | null;
  lastActivityAt: number | null;
};

export type FriendDomainCandidate = {
  domain: string;
  broadCategory: string | null;
  signal: FriendDomainSignal;
  lastActivityAt: number | null;
  strength: number;
  /** Friends whose world surfaces this domain, most-recent first (for attribution). */
  presenceSources: PresenceSource[];
};

const SIGNAL_RANK: Record<FriendDomainSignal, number> = {
  both: 0,
  territory: 1,
  activity: 2,
};

/**
 * Merge per-friend contributions into ranked candidate domains. Pure and
 * deterministic so it can be unit-tested without a DB.
 *
 * Rank: Both > territory-only > activity-only, then recency (newest first,
 * nulls last), then strength (points), then domain name for stability. Dedup by
 * domain; caller slices to DAILY_BONUS_SLOT_MAX.
 */
export function rankFriendDomainsForBonus(
  contributions: FriendDomainContribution[],
  limit: number,
): FriendDomainCandidate[] {
  if (limit <= 0) return [];

  type Acc = {
    domain: string;
    broadCategory: string | null;
    anyTerritory: boolean;
    anyActivity: boolean;
    lastActivityAt: number | null;
    strength: number;
    sources: Map<string, PresenceSource>;
  };
  const byDomain = new Map<string, Acc>();

  for (const c of contributions) {
    const domain = c.domain.trim();
    if (!domain) continue;
    if (isGenericSubcategory(domain)) continue;
    if (!c.inTerritory && !c.inActivity) continue; // no signal at all
    const key = domain.toLowerCase();

    let acc = byDomain.get(key);
    if (!acc) {
      acc = {
        domain,
        broadCategory: c.broadCategory,
        anyTerritory: false,
        anyActivity: false,
        lastActivityAt: null,
        strength: 0,
        sources: new Map(),
      };
      byDomain.set(key, acc);
    }
    acc.anyTerritory ||= c.inTerritory;
    acc.anyActivity ||= c.inActivity;
    if (c.broadCategory && !acc.broadCategory) acc.broadCategory = c.broadCategory;
    if (
      c.lastActivityAt != null &&
      (acc.lastActivityAt == null || c.lastActivityAt > acc.lastActivityAt)
    ) {
      acc.lastActivityAt = c.lastActivityAt;
    }
    if (c.strength > acc.strength) acc.strength = c.strength;

    // Keep the strongest-recency record per friend for attribution ordering.
    const existingSource = acc.sources.get(c.friendId);
    if (
      !existingSource ||
      (c.lastActivityAt != null &&
        (existingSource.lastActivityAt == null || c.lastActivityAt > existingSource.lastActivityAt))
    ) {
      acc.sources.set(c.friendId, {
        userId: c.friendId,
        displayName: c.friendDisplayName,
        lastActivityAt: c.lastActivityAt,
      });
    }
  }

  const candidates: FriendDomainCandidate[] = [...byDomain.values()].map((acc) => {
    const signal: FriendDomainSignal =
      acc.anyTerritory && acc.anyActivity ? 'both' : acc.anyTerritory ? 'territory' : 'activity';
    const presenceSources = [...acc.sources.values()].sort(sourceByRecency);
    return {
      domain: acc.domain,
      broadCategory: acc.broadCategory,
      signal,
      lastActivityAt: acc.lastActivityAt,
      strength: acc.strength,
      presenceSources,
    };
  });

  return candidates
    .sort((a, b) => {
      const sig = SIGNAL_RANK[a.signal] - SIGNAL_RANK[b.signal];
      if (sig !== 0) return sig;
      const rec = recencyDesc(a.lastActivityAt, b.lastActivityAt);
      if (rec !== 0) return rec;
      if (a.strength !== b.strength) return b.strength - a.strength; // tie-break, not a gate
      return a.domain.toLowerCase().localeCompare(b.domain.toLowerCase());
    })
    .slice(0, limit);
}

function sourceByRecency(a: PresenceSource, b: PresenceSource): number {
  return recencyDesc(a.lastActivityAt, b.lastActivityAt);
}

// Newest first; nulls sort last.
function recencyDesc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

/** A territory domain is one the friend declared or has demonstrated, and hasn't hidden. */
function isTerritoryDomain(domain: DomainMastery): boolean {
  if (domain.isHidden) return false;
  return domain.isDeclared || domain.isDeclaredInterest || domain.isDemonstrated;
}

/**
 * The activity signal additionally requires at least one CORRECT answer.
 *
 * `selectRecentlyExploring` gates only on recency + `!isHidden`, which is right
 * for the profile's "Recently exploring" section — answering wrong IS exploring,
 * and that section describes you to yourself. It is NOT enough to put a domain
 * into someone ELSE's Daily Five: without this floor a single wrong answer
 * promotes a domain to "{Name}'s world" and broadcasts it to everyone who
 * follows them. Mirrors the `demonstrated` aggregate in `loadDomainAggregatesBulk`,
 * which likewise requires `answerState <> 'incorrect'`; the territory path
 * already inherits that gate via `isDemonstrated`, so only activity was open.
 *
 * Lifetime-correct rather than correct-in-window: the point is to establish that
 * the friend has real purchase on the domain at all, not to re-litigate recency
 * (`selectRecentlyExploring` already applied the 30-day window).
 */
function hasEarnedActivity(domain: DomainMastery): boolean {
  return domain.questionsCorrect > 0;
}

function activityMs(lastActivityAt: string | null): number | null {
  if (!lastActivityAt) return null;
  const ms = new Date(lastActivityAt).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Build the ranked +2 domain pool from territory ∪ activity across the people the
 * viewer follows. Returns at most `limit` candidates (DAILY_BONUS_SLOT_MAX). The
 * pool is friend-sourced only — it never includes the viewer's own domains, so a
 * viewer who follows no one (or no one with eligible domains) gets an empty pool
 * (clean 5). That own-domain subtraction is ENFORCED below (`ownDomains`), not
 * merely assumed: it was documented here and in the orchestrator for a long time
 * while nothing implemented it, which let a friend's answer in the viewer's own
 * domain round-trip back as "from {Name}'s world".
 *
 * Privacy: the presence signal honors the same `knowledge_base` SECTION
 * visibility the profile enforces (`canViewSection`). Following is one-way, so
 * the viewer is a `stranger` for section-visibility purposes unless the follow
 * is mutual (`friend`). A followee whose `knowledge_base` is hidden from the
 * effective viewer contributes NOTHING — neither territory nor activity, since
 * the profile gates both surfaces behind that same section (see
 * `users/[id]/page.tsx`). Per-domain `isHidden` is still applied on top, exactly
 * as the profile does (see `isTerritoryDomain` / the `inActivity` check below).
 */
export async function getFriendDomainsForBonus(
  viewerUserId: string,
  limit: number,
  // Lowercased domains the viewer parked in "Resting" ("won't be asked"). A
  // rested domain is dropped from the bonus pool BEFORE ranking/limiting, so the
  // opt-out ("This is {Name}'s bag but not mine") holds for the +2 the same way
  // it already does for the core five — and we still surface up to `limit`
  // non-rested friend domains rather than letting a rested one consume a slot.
  excludeDomains: ReadonlySet<string> = new Set(),
): Promise<FriendDomainCandidate[]> {
  if (limit <= 0) return [];

  const following = await getFollowing(viewerUserId);
  if (following.length === 0) return [];

  // A followee the viewer mutually follows is a `friend` for visibility; any
  // other followee (one-way follow) is a `stranger`. One query for the whole
  // mutual set beats N per-friend `areFriends` round-trips.
  const mutualIds = new Set((await getMutualFollows(viewerUserId)).map((u) => u.id));

  // Section visibility for the whole followee set in ONE query, then the same
  // `canViewSection` gate the profile enforces, applied in memory. A followee
  // whose `knowledge_base` is hidden from the viewer's effective role is dropped
  // here and never has their knowledge map fetched — identical to the old
  // per-friend gate, minus the per-friend round-trip.
  const visibilityByFriend = await getSectionVisibilitiesBulk(following.map((f) => f.id));
  const visibleFriends = following.filter((friend) => {
    const effectiveViewer: EffectiveViewer = mutualIds.has(friend.id) ? 'friend' : 'stranger';
    const settings = visibilityByFriend.get(friend.id);
    return settings ? canViewSection(settings, 'knowledge_base', effectiveViewer) : false;
  });
  if (visibleFriends.length === 0) return [];

  // Every surviving friend's domains in ONE batched fetch (the bonus pool only
  // consumes `allDomains`). Bounded query count regardless of followee count.
  // A batch failure degrades to an empty pool — the same best-effort posture the
  // old per-friend `.catch(() => ({ allDomains: [] }))` gave each fetch.
  // The viewer rides along in the SAME batched query as the friends (one extra
  // row, no extra round-trip) so their own map can be subtracted below.
  const domainsByUser = await getKnowledgePageDataForUsers([
    ...visibleFriends.map((f) => f.id),
    viewerUserId,
  ]).catch(() => new Map<string, DomainMastery[]>());

  // *** The viewer's OWN domains — subtracted from the pool. ***
  // This is what makes the "friend-sourced only" invariant above real; it was
  // documented here and in the orchestrator but never enforced. Without it the
  // +2 hands a player their own territory back under a friend's name: a followee
  // who answers a question in the viewer's domain picks that domain up as
  // territory (or, before the correctness floor below, as bare activity) and it
  // returns to the viewer as "from {Name}'s world".
  // Every domain in the viewer's own knowledge map is theirs — declared,
  // demonstrated, or merely played — so the whole map is excluded, hidden
  // domains included (hiding a domain doesn't make it someone else's).
  const ownDomains = new Set(
    (domainsByUser.get(viewerUserId) ?? []).map((d) => d.domain.toLowerCase()),
  );

  const contributions: FriendDomainContribution[] = [];
  for (const friend of visibleFriends) {
    const allDomains = domainsByUser.get(friend.id) ?? [];
    const activityDomains = new Set(
      selectRecentlyExploring(allDomains).map((d) => d.domain.toLowerCase()),
    );

    for (const domain of allDomains) {
      const key = domain.domain.toLowerCase();
      if (excludeDomains.has(key)) continue;
      if (ownDomains.has(key)) continue;
      const inTerritory = isTerritoryDomain(domain);
      const inActivity = !domain.isHidden && hasEarnedActivity(domain) && activityDomains.has(key);
      if (!inTerritory && !inActivity) continue;
      contributions.push({
        friendId: friend.id,
        friendDisplayName: friend.displayName ?? null,
        domain: domain.domain,
        broadCategory: domain.broadCategory,
        inTerritory,
        inActivity,
        lastActivityAt: activityMs(domain.lastActivityAt),
        strength: domain.points,
      });
    }
  }

  return rankFriendDomainsForBonus(contributions, limit);
}
