/**
 * Refine Your Game — DB reads + section assembly.
 *
 * Pure firing rules and copy live under src/server/refine/; this module loads
 * the evidence they need (owned set, miss-streak history, cooldowns, existing
 * decisions) and assembles the RefineSectionView consumed by the daily summary.
 */

import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';

import { db, dailyRefineDecisions, masteryEvents, userDomainDifficulties } from '@/server/db';
import type { QueueSlot } from '@/server/daily/types';
import { getBonusCount } from '@/server/daily/bonus';
import { getKnowledgeBase } from '@/server/db/queries/daily';
import {
  deriveDifficultyEscalation,
  deriveFriendExpansion,
  deriveStrugglePruning,
  type MissStreak,
} from '@/server/refine/derive';
import { openText, resolvedText, subdomainLabel } from '@/server/refine/copy';
import { selectRefineCandidates } from '@/server/refine/select';
import {
  REFINE_VERB,
  refineItemKey,
  type RefineCandidate,
  type RefineItem,
  type RefineItemType,
  type RefineMissTier,
  type RefineSectionView,
} from '@/server/refine/types';

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

/** Assemble the RefineSectionView for the daily summary. */
export async function buildRefineSection(
  userId: string,
  queueId: string,
  slots: QueueSlot[],
): Promise<RefineSectionView> {
  if (slots.length === 0) return { queueId, items: [] };
  const [selected, pendingKeys] = await Promise.all([
    deriveSelectedRefineCandidates(userId, slots),
    getPendingDecisionKeys(userId, queueId),
  ]);
  return {
    queueId,
    items: selected.map((candidate) => candidateToItem(candidate, queueId, pendingKeys)),
  };
}
