/**
 * Refine Your Game — DB reads + section assembly.
 *
 * Pure firing rules and copy live under src/server/refine/; this module loads
 * the evidence they need (owned set, miss-streak history, cooldowns, existing
 * decisions) and assembles the RefineSectionView consumed by the daily summary.
 */

import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

import {
  db,
  dailyRefineDecisions,
  declaredInterests,
  masteryEvents,
  userDomainDifficulties,
} from '@/server/db';
import type { QueueSlot } from '@/server/daily/types';
import { getBonusCount } from '@/server/daily/bonus';
import { getKnowledgeBase } from '@/server/db/queries/daily';
import {
  deriveDifficultyEscalation,
  deriveFriendExpansion,
  deriveStrugglePruning,
  type MissStreak,
} from '@/server/refine/derive';
import {
  ADD_TERRITORIES_OPEN_TEXT,
  ADD_TERRITORIES_RESOLVED_TEXT,
  openText,
  resolvedText,
  subdomainLabel,
} from '@/server/refine/copy';
import { selectRefineCandidates } from '@/server/refine/select';
import {
  REFINE_MAX_ITEMS,
  REFINE_VERB,
  refineItemKey,
  shouldNudgeAddTerritories,
  type RefineCandidate,
  type RefineItem,
  type RefineItemType,
  type RefineMissTier,
  type RefineSectionView,
} from '@/server/refine/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the add_territories nudge sends the player (same as Customize / Settings). */
const ADD_TERRITORIES_HREF = '/daily/setup';

/** Lowercased canonical subcategories the player currently owns (knowledge base). */
export async function getOwnedSubcategories(userId: string): Promise<Set<string>> {
  const knowledgeBase = await getKnowledgeBase(userId);
  return new Set(knowledgeBase.map((domain) => domain.domain.toLowerCase()));
}

async function getServedDifficulties(
  userId: string,
  domains: string[],
): Promise<Map<string, RefineMissTier>> {
  if (domains.length === 0) return new Map();
  const rows = await db
    .select({
      domain: userDomainDifficulties.canonicalSubcategory,
      served: userDomainDifficulties.servedDifficulty,
    })
    .from(userDomainDifficulties)
    .where(
      and(
        eq(userDomainDifficulties.userId, userId),
        inArray(userDomainDifficulties.canonicalSubcategory, domains),
      ),
    );
  return new Map(rows.map((row) => [row.domain, row.served as RefineMissTier]));
}

/**
 * Trailing consecutive-miss run per domain in the just-finished queue.
 *
 * Walks MASTERY_EVENTS most-recent-first per subcategory: an 'incorrect' extends
 * the run, any correct answer ends it (resets to 0), non-graded credit rows
 * (null answer_state) are skipped. The latest-miss tier comes from the most
 * recent incorrect slot in this queue, falling back to the served difficulty.
 */
export async function getMissStreaks(userId: string, slots: QueueSlot[]): Promise<MissStreak[]> {
  const domains = [
    ...new Set(slots.map((slot) => slot.domain).filter((d): d is string => Boolean(d))),
  ];
  if (domains.length === 0) return [];

  // Latest-miss tier from in-queue slots (later slot_index = more recent).
  const latestSlotMissTier = new Map<string, RefineMissTier>();
  const orderedSlots = [...slots].sort((a, b) => a.slot_index - b.slot_index);
  for (const slot of orderedSlots) {
    if (slot.answer_state !== 'incorrect') continue;
    if (!slot.domain || !slot.difficulty_estimate) continue;
    latestSlotMissTier.set(slot.domain, slot.difficulty_estimate);
  }

  const [served, events] = await Promise.all([
    getServedDifficulties(userId, domains),
    db
      .select({
        domain: masteryEvents.canonicalSubcategory,
        answerState: masteryEvents.answerState,
      })
      .from(masteryEvents)
      .where(
        and(eq(masteryEvents.userId, userId), inArray(masteryEvents.canonicalSubcategory, domains)),
      )
      .orderBy(masteryEvents.canonicalSubcategory, desc(masteryEvents.createdAt)),
  ]);

  const counts = new Map<string, number>();
  const stopped = new Set<string>();
  for (const event of events) {
    if (stopped.has(event.domain)) continue;
    if (event.answerState === 'incorrect') {
      counts.set(event.domain, (counts.get(event.domain) ?? 0) + 1);
    } else if (event.answerState === null) {
      continue; // non-graded credit row — neither extends nor breaks the run
    } else {
      stopped.add(event.domain); // a correct answer ends the trailing miss run
    }
  }

  const streaks: MissStreak[] = [];
  for (const domain of domains) {
    const count = counts.get(domain) ?? 0;
    if (count <= 0) continue;
    streaks.push({
      subdomainId: domain,
      subdomainLabel: subdomainLabel(domain),
      count,
      latestMissTier: latestSlotMissTier.get(domain) ?? served.get(domain) ?? 'moderate',
    });
  }
  return streaks;
}

/** Item keys whose cooldown is still active (suppressed from re-firing). */
export async function getActiveCooldowns(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      itemType: dailyRefineDecisions.itemType,
      subdomain: dailyRefineDecisions.canonicalSubcategory,
      friendId: dailyRefineDecisions.friendId,
    })
    .from(dailyRefineDecisions)
    .where(
      and(
        eq(dailyRefineDecisions.userId, userId),
        gt(dailyRefineDecisions.cooldownUntil, new Date()),
      ),
    );
  return new Set(
    rows.map((row) => refineItemKey(row.itemType as RefineItemType, row.subdomain, row.friendId)),
  );
}

/** Item keys with a staged (uncommitted) decision for this queue → render resolved. */
async function getPendingDecisionKeys(userId: string, queueId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      itemType: dailyRefineDecisions.itemType,
      subdomain: dailyRefineDecisions.canonicalSubcategory,
      friendId: dailyRefineDecisions.friendId,
    })
    .from(dailyRefineDecisions)
    .where(
      and(
        eq(dailyRefineDecisions.userId, userId),
        eq(dailyRefineDecisions.queueId, queueId),
        eq(dailyRefineDecisions.action, 'pending'),
        isNull(dailyRefineDecisions.committedAt),
      ),
    );
  return new Set(
    rows.map((row) => refineItemKey(row.itemType as RefineItemType, row.subdomain, row.friendId)),
  );
}

function candidateToItem(
  candidate: RefineCandidate,
  queueId: string,
  pendingKeys: Set<string>,
): RefineItem {
  const key = refineItemKey(candidate.type, candidate.subdomainId, candidate.friendId);
  return {
    id: `${queueId}:${key}`,
    type: candidate.type,
    subdomainId: candidate.subdomainId,
    subdomainLabel: candidate.subdomainLabel,
    friendId: candidate.friendId,
    friendName: candidate.friendName,
    openText: openText(candidate),
    resolvedText: resolvedText(candidate),
    actionVerb: REFINE_VERB[candidate.type],
    state: pendingKeys.has(key) ? 'resolved' : 'open',
  };
}

/**
 * Re-derives the refine candidates for a given queue (shared by the summary
 * builder and the resolve/commit paths so the server never trusts the client
 * about which items are real). Returns selected, cooldown-filtered candidates.
 */
export async function deriveSelectedRefineCandidates(
  userId: string,
  slots: QueueSlot[],
): Promise<RefineCandidate[]> {
  if (slots.length === 0) return [];
  const [ownedSet, missStreaks, cooldowns] = await Promise.all([
    getOwnedSubcategories(userId),
    getMissStreaks(userId, slots),
    getActiveCooldowns(userId),
  ]);
  const friendExpansion = deriveFriendExpansion(slots, ownedSet);
  const difficultyEscalation = deriveDifficultyEscalation(slots);
  const strugglePruning = deriveStrugglePruning(missStreaks);
  const candidates: RefineCandidate[] = [
    ...friendExpansion,
    ...difficultyEscalation,
    ...strugglePruning,
  ];
  const selected = selectRefineCandidates(candidates, cooldowns);

  // REFINE_DEBUG=1 surfaces why the section is (usually) empty: per-rule raw
  // counts, the miss streaks feeding struggle-pruning, and how many candidates
  // the active cooldowns suppress. Opt-in so it stays off normal daily loads.
  if (process.env.REFINE_DEBUG === '1') {
    console.info('[refine/derive]', {
      userId,
      slotCount: slots.length,
      bonusSlots: getBonusCount(slots),
      steppedUpSlots: slots.filter((s) => s.difficulty_stepped_up === true).length,
      missStreaks: missStreaks.map((s) => ({
        domain: s.subdomainId,
        count: s.count,
        tier: s.latestMissTier,
      })),
      raw: {
        friend_expansion: friendExpansion.length,
        difficulty_escalation: difficultyEscalation.length,
        struggle_pruning: strugglePruning.length,
      },
      activeCooldowns: cooldowns.size,
      suppressedByCooldown: candidates.length - selected.length,
      selected: selected.length,
    });
  }

  return selected;
}

/**
 * Whole-number days since the player last added an active territory, or null if
 * they've never added one. The signal is the most recent DeclaredInterest the
 * player still owns — adding a category writes a fresh `declaredAt`, so this
 * resets the moment they act (which is what retires the nudge).
 */
export async function getDaysSinceLastTerritoryAdd(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ last: sql<string | null>`max(${declaredInterests.declaredAt})` })
    .from(declaredInterests)
    .where(and(eq(declaredInterests.userId, userId), eq(declaredInterests.isActive, true)));
  if (!row?.last) return null;
  const lastMs = new Date(row.last).getTime();
  if (Number.isNaN(lastMs)) return null;
  return Math.floor((Date.now() - lastMs) / DAY_MS);
}

/** The navigational "add some categories?" nudge — global, never staged. */
function buildAddTerritoriesItem(queueId: string): RefineItem {
  return {
    id: `${queueId}:add_territories`,
    type: 'add_territories',
    subdomainId: '',
    subdomainLabel: '',
    openText: ADD_TERRITORIES_OPEN_TEXT,
    resolvedText: ADD_TERRITORIES_RESOLVED_TEXT,
    actionVerb: REFINE_VERB.add_territories,
    state: 'open',
    href: ADD_TERRITORIES_HREF,
  };
}

/** Assemble the RefineSectionView for the daily summary. */
export async function buildRefineSection(
  userId: string,
  queueId: string,
  slots: QueueSlot[],
  /**
   * True when today's round already demonstrated at least one new domain
   * (daily-summary.ts's `newTerritory`) — a "Knowledge updated" moment the
   * player just saw in the round. `getDaysSinceLastTerritoryAdd` reads
   * `declaredInterests`, a DIFFERENT table from the `playerMastery` write a
   * demonstrated add makes, so it stays blind to it and the inactivity nudge
   * could otherwise say "you haven't added anything new" in the same summary
   * (UX review Priority 6 / Screen 15). Suppress it outright on those days
   * rather than let two different "added" claims contradict each other.
   */
  hasNewTerritoryToday: boolean = false,
): Promise<RefineSectionView> {
  if (slots.length === 0) return { queueId, items: [] };
  const [selected, pendingKeys, daysSinceLastAdd] = await Promise.all([
    deriveSelectedRefineCandidates(userId, slots),
    getPendingDecisionKeys(userId, queueId),
    getDaysSinceLastTerritoryAdd(userId),
  ]);
  const items = selected.map((candidate) => candidateToItem(candidate, queueId, pendingKeys));

  // Inactivity nudge fills any room the evidence-based items leave open: if the
  // player hasn't added a territory recently, offer to add some. Lowest priority,
  // so an engaged day with three evidence items crowds it out.
  if (
    items.length < REFINE_MAX_ITEMS &&
    !hasNewTerritoryToday &&
    shouldNudgeAddTerritories(daysSinceLastAdd)
  ) {
    items.push(buildAddTerritoriesItem(queueId));
  }

  return { queueId, items };
}
