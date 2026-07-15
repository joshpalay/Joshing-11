import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';

import { getNextDailyResetBoundary } from '@/lib/games/timezone';
import { titleCaseDomain } from '@/lib/knowledge/domain-casing';
import {
  dailyQueues,
  db,
  declaredInterests,
  generatedQuestions,
  masteryEvents,
  playerMastery,
  users,
} from '@/server/db';
import {
  getExpansionOfferedDomains,
  getPendingExpansionDomains,
} from '@/server/adaptive-difficulty';
import {
  isAreaExpansionThinnessTriggerEnabled,
  isNearnessTreeEnabled,
  narrowKbThinnessThreshold,
  selectThinnestEligibleArea,
} from '@/server/daily/kb-exhaustion';
import type { AdjacentDomainSuggestion } from '@/server/llm/interests';
import { suggestAdjacentDomains, suggestBroaderDomains } from '@/server/llm/interests';
import { evaluateSetCompletions } from '@/server/daily/set-completion';
import { getCachedDomainRungs } from '@/server/knowledge/nearness-tree';
import { getHeldDomainKeys } from '@/server/db/queries/nearness-overlay';
import { domainKey } from '@/lib/knowledge/domain-key';
import { getDurablePoolDepthForDomains } from '@/server/db/queries/retrieval-demand';
import { resolveTier } from '@/server/mastery/tiers';
import { checkBankedQuestions } from '@/server/db/queries/bank';
import { getViewerHiddenQuestionIds } from '@/server/db/queries/content-reports';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { buildRefineSection } from '@/server/db/queries/refine';
import { getFeedPagePayload } from '@/server/feed/get-feed-page';
import type { QueueSlot } from '@/server/daily/types';
import { getSlotPresence, isBonusSlot } from '@/server/daily/bonus';
import type { RefineSectionView } from '@/server/refine/types';
import type { MasteryTier } from '@/types/db';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type DailySummaryView = {
  date: string;
  totalAnswered: number;
  totalCorrect: number;
  totalSkipped: number;
  pointsEarned: number;
  difficultyMode: string | null;
  questions: QuestionRecap[];
  domainGains: DomainGain[];
  newTerritory: string[];
  tierCrossings: TierCrossing[];
  recentFriendBridge: RecentFriendBridge | null;
  /**
   * Count of question cards from friends still waiting for the player across the
   * two direct surfaces — "Sent" (a friend sent it straight to you) plus
   * "Broadcasts" (a friend created/shared it). Drives the recap's quiet "you have
   * N questions from friends" nudge; 0 hides the line.
   */
  pendingFriendQuestions: number;
  isFirstCompletedRound: boolean;
  reminderPromptState: 'show' | 'hidden';
  /**
   * D-REMINDER-INTERSTITIAL-01: whether the one-time full-screen reminder
   * interstitial should fire when the player exits this summary via a `/` path
   * (✕, "Session recap", "Back home"). 'show' when reminder_interstitial_seen_at
   * IS NULL and the player has not already engaged reminders. Independent of
   * isFirstCompletedRound — E1 collapsed the first-session special case.
   */
  reminderInterstitialState: 'show' | 'hidden';
  /**
   * Whether the player already has a verified email — lets the interstitial's
   * "Email me" opt them in with one tap instead of collecting an address.
   */
  hasVerifiedEmail: boolean;
  /** Contextual "Refine Your Game" offers derived from this daily (empty → reassurance state). */
  refine: RefineSectionView;
  /**
   * Post-daily-Five "you're crushing X — branch out?" offer. Set when the player
   * topped a domain's difficulty ladder yet still out-ran its content (the
   * supply-ceiling moment), with LLM-suggested adjacent domains to add. Null when
   * no offer is pending. Surfaces until accepted or dismissed.
   */
  expansionOffer: ExpansionOffer | null;
};

/**
 * One pickable target in the expansion offer. `kind` distinguishes a *wider*
 * sibling (lateral neighbour) from a *broader* parent (one level up) so the card
 * can group them (B-AREA-EXPANSION-01, R1/R3).
 */
export type ExpansionCandidate = {
  label: string;
  broadCategory: string | null;
  kind: 'wider' | 'broader';
};

export type ExpansionOffer = {
  /** Canonical subcategory the player mastered (the offer's anchor). */
  sourceDomain: string;
  sourceDisplayName: string;
  /** Wider siblings and broader parents the player can add to their rotation. */
  candidates: ExpansionCandidate[];
};

export type RecentFriendBridge = {
  friendName: string;
  cardType: string;
  domainDisplayName: string | null;
};

export type QuestionRecap = {
  questionId: string;
  bankQuestionId: string | null;
  questionText: string;
  submittedAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  isSkipped: boolean;
  explanation: string;
  domain: string;
  domainDisplayName: string;
  isInBank: boolean;
  /** Author display name — set for friend-authored and house questions. */
  authorName: string | null;
  /**
   * Author's user id — only for human (friend-authored) questions, so the recap
   * can link the name to their profile (B5/D9). Null for house/editorial and
   * LLM-origin questions, which have no users.id to link to.
   */
  authorId: string | null;
  /** Author's why — commentary attached at creation, surfaced in the recap. */
  authorNote: string | null;
  /** D-3: the author is the non-human house/editorial author (Editorial badge, non-relational copy). */
  authorIsHouse: boolean;
  /**
   * Daily Five +2: this recap row is an additive bonus question (D-4 §B), set via
   * the shared bonus selector. Drives the recap dot-track split (core | gap |
   * bonus). Never enters the spoken X/5 count.
   */
  isBonus: boolean;
  /**
   * Presence attribution for a +2 bonus row: the named friend whose knowledge
   * surfaced this domain, for the quiet "from {Name}'s knowledge" sub-line (D-F4).
   * Null for core rows and for bonus rows whose friend has no display name (no
   * name → no sub-line). Deliberately NOT routed through `authorName`: the friend
   * did not author or answer the question — this names WHERE the domain came from.
   */
  bonusPresence: { name: string; extraCount: number } | null;
  /**
   * B-Report-2: which content table this recap row points at, for a ContentReport.
   * Exactly one id is set — curated questions carry `questionId`, LLM-origin questions
   * carry `generatedQuestionId`. Null only for the synthetic-fallback slot (no real row
   * to report), in which case the ⋯ report items are hidden.
   */
  reportTarget:
    | { questionId: string; generatedQuestionId?: undefined }
    | { generatedQuestionId: string; questionId?: undefined }
    | null;
};

export type DomainGain = {
  domain: string;
  displayName: string;
  broadCategory: string;
  pointsGained: number;
  totalPoints: number;
  currentTier: MasteryTier;
  isNewTerritory: boolean;
};

export type TierCrossing = {
  domain: string;
  fromTier: MasteryTier;
  toTier: MasteryTier;
};

function asIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

function displayNameForDomain(domain: string): string {
  return titleCaseDomain(domain);
}

function dateStart(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

export async function getDailySummary(userId: string, date: Date): Promise<DailySummaryView> {
  const dateString = asIsoDate(date);
  const [queue] = await db
    .select()
    .from(dailyQueues)
    .where(and(eq(dailyQueues.userId, userId), eq(dailyQueues.queueDate, dateString)))
    .limit(1);

  const slots = asQueueSlots(queue?.slots);
  const generatedIds = slots
    .map((slot) => slot.generated_question_id)
    .filter((id): id is string => Boolean(id));

  const [questions, todayEvents, prefs] = await Promise.all([
    generatedIds.length > 0
      ? db
          .select()
          .from(generatedQuestions)
          .where(and(
            eq(generatedQuestions.userId, userId),
            inArray(generatedQuestions.id, generatedIds),
          ))
      : Promise.resolve([]),
    queue
      ? db
          .select({
            domain: masteryEvents.canonicalSubcategory,
            awardedPoints: masteryEvents.awardedPoints,
          })
          .from(masteryEvents)
          .where(and(
            eq(masteryEvents.userId, userId),
            eq(masteryEvents.sessionContext, 'daily'),
            sql`${masteryEvents.answerId} like ${`daily:${queue.id}:%`}`,
          ))
      : Promise.resolve([]),
    getDailyPreferences(userId),
  ]);

  const questionById = new Map(questions.map((question) => [question.id, question]));
  const pointsByDomain = new Map<string, number>();
  const touchedDomains = new Set<string>();

  for (const event of todayEvents) {
    touchedDomains.add(event.domain);
    pointsByDomain.set(event.domain, (pointsByDomain.get(event.domain) ?? 0) + Number(event.awardedPoints ?? 0));
  }

  const slotPointsByDomain = new Map<string, number>();
  for (const slot of slots) {
    if (!slot.domain) continue;
    touchedDomains.add(slot.domain);

    const slotPoints = Number(slot.awarded_points ?? 0);
    if (slotPoints > 0) {
      slotPointsByDomain.set(slot.domain, (slotPointsByDomain.get(slot.domain) ?? 0) + slotPoints);
    }
  }

  for (const [domain, slotPoints] of slotPointsByDomain) {
    // The queue slot is the source of truth for the visible round total. If the
    // mastery event write is missing or undercounts a domain, keep the per-domain
    // recap in sync with the total card instead of showing +0 under a +N total.
    pointsByDomain.set(domain, Math.max(pointsByDomain.get(domain) ?? 0, slotPoints));
  }

  const priorRows = touchedDomains.size > 0
    ? await db
        .select({
          domain: masteryEvents.canonicalSubcategory,
          count: sql<number>`count(*)`,
        })
        .from(masteryEvents)
        .where(and(
          eq(masteryEvents.userId, userId),
          inArray(masteryEvents.canonicalSubcategory, [...touchedDomains]),
          lt(masteryEvents.createdAt, dateStart(dateString)),
        ))
        .groupBy(masteryEvents.canonicalSubcategory)
    : [];
  const priorEventDomains = new Set(priorRows.filter((row) => Number(row.count) > 0).map((row) => row.domain));
  const newTerritory = [...touchedDomains].filter((domain) => !priorEventDomains.has(domain));

  const masteryRows = touchedDomains.size > 0
    ? await db
        .select({
          domain: playerMastery.canonicalSubcategory,
          broadCategory: playerMastery.broadCategory,
          totalPoints: playerMastery.totalPoints,
          tier: playerMastery.tier,
          territoryType: playerMastery.territoryType,
        })
        .from(playerMastery)
        .where(and(
          eq(playerMastery.userId, userId),
          inArray(playerMastery.canonicalSubcategory, [...touchedDomains]),
        ))
    : [];
  const masteryByDomain = new Map(masteryRows.map((row) => [row.domain, row]));

  const tierCrossings: TierCrossing[] = [...pointsByDomain.entries()]
    .map(([domain, pointsGained]) => {
      const mastery = masteryByDomain.get(domain);
      if (!mastery || pointsGained <= 0) return null;
      const fromTier = resolveTier(Math.max(0, Number(mastery.totalPoints ?? 0) - pointsGained));
      const toTier = mastery.tier;
      return fromTier !== toTier ? { domain, fromTier, toTier } : null;
    })
    .filter((row): row is TierCrossing => Boolean(row));

  const recapQuestionIds = slots
    .map((slot) => slot.question_id)
    .filter((id): id is string => Boolean(id));
  const bankedById = await checkBankedQuestions(userId, recapQuestionIds);

  const recaps = slots.map<QuestionRecap>((slot) => {
    const generated = slot.generated_question_id ? questionById.get(slot.generated_question_id) : null;
    const presence = getSlotPresence(slot);
    const domain = slot.domain || generated?.canonicalSubcategory || 'General';
    const questionId = slot.question_id ?? slot.generated_question_id ?? `${queue?.id ?? dateString}:${slot.slot_index}`;
    return {
      questionId,
      bankQuestionId: slot.question_id ?? null,
      questionText: slot.question_text || generated?.questionText || '',
      submittedAnswer: slot.submitted_answer ?? null,
      correctAnswer: slot.reveal_canonical_answer ?? generated?.answer ?? '',
      isCorrect: slot.answer_state === 'correct',
      isSkipped: Boolean(slot.skipped),
      explanation: slot.reveal_explainer ?? generated?.explainer ?? '',
      domain,
      domainDisplayName: displayNameForDomain(domain),
      isInBank: slot.question_id ? Boolean(bankedById[slot.question_id]) : false,
      authorName: slot.source === 'friend' || slot.source === 'house' ? (slot.author_name ?? null) : null,
      // Only friend (human) authors have a linkable profile; house has no users.id.
      authorId: slot.source === 'friend' ? (slot.author_id ?? null) : null,
      authorNote: slot.source === 'friend' || slot.source === 'house' ? (slot.author_note ?? null) : null,
      authorIsHouse: slot.source === 'house',
      isBonus: isBonusSlot(slot),
      bonusPresence:
        presence && presence.name
          ? { name: presence.name, extraCount: presence.extraCount }
          : null,
      reportTarget: slot.question_id
        ? { questionId: slot.question_id }
        : slot.generated_question_id
          ? { generatedQuestionId: slot.generated_question_id }
          : null,
    };
  });

  // B-Report-3: durable self-hide. A recap card the viewer reported as
  // inappropriate (open|upheld) stays gone across refreshes — read straight from
  // the ContentReport row, no new state. Incorrect reports do not self-hide.
  // Totals stay computed from slots (below), matching B-Report-2's card-only removal.
  const reportTargetIds = recaps
    .map((recap) => recap.reportTarget?.questionId ?? recap.reportTarget?.generatedQuestionId)
    .filter((id): id is string => Boolean(id));
  const hiddenIds = await getViewerHiddenQuestionIds(userId, reportTargetIds);
  const visibleRecaps =
    hiddenIds.size === 0
      ? recaps
      : recaps.filter((recap) => {
          const targetId = recap.reportTarget?.questionId ?? recap.reportTarget?.generatedQuestionId;
          return !(targetId && hiddenIds.has(targetId));
        });

  const totalSkipped = slots.filter((slot) => slot.skipped).length;
  const totalAnswered = slots.filter((slot) => slot.answered).length;
  const totalCorrect = slots.filter((slot) => slot.answer_state === 'correct').length;
  const pointsEarned = [...pointsByDomain.values()].reduce((sum, points) => sum + points, 0);
  const gainedDomains = [...touchedDomains].filter((domain) => (pointsByDomain.get(domain) ?? 0) > 0);

  const { recentFriendBridge, pendingFriendQuestions } =
    await getFriendSummarySignals(userId);
  const {
    isFirstCompletedRound,
    reminderPromptState,
    reminderInterstitialState,
    hasVerifiedEmail,
  } = await computeReminderPromptState(userId, dateString, totalAnswered);
  const refine: RefineSectionView = queue
    ? await buildRefineSection(userId, queue.id, slots)
    : { queueId: null, items: [] };
  const touchedForExpansion: TouchedDomainForExpansion[] = [...touchedDomains].map((domain) => ({
    domain,
    territoryType: masteryByDomain.get(domain)?.territoryType ?? null,
  }));
  // D-SUPPLY-FINITE-SET-01 P2: designate + auto-invite domains this player just
  // completed (answered the whole finite set). Creates the AuthorInvitation the
  // summary's InvitationTakeoverGate routes to /invited (the trophy), AND marks the
  // completed domain expansion-eligible. Runs BEFORE buildExpansionOffer so a
  // just-completed set surfaces the graduation ("branch out") card in the SAME
  // summary (D-DIFFICULTY-SIZE-COMPLETION-01 Phase 1b). Fail-open; never blocks.
  await evaluateSetCompletions(
    userId,
    touchedForExpansion.map((t) => t.domain),
  );

  const expansionOffer = await buildExpansionOffer(userId, touchedForExpansion);

  return {
    date: dateString,
    totalAnswered,
    totalCorrect,
    totalSkipped,
    pointsEarned,
    difficultyMode: prefs.difficulty,
    questions: visibleRecaps,
    domainGains: gainedDomains
      .map((domain) => ({
        domain,
        displayName: displayNameForDomain(domain),
        broadCategory: masteryByDomain.get(domain)?.broadCategory || domain,
        pointsGained: pointsByDomain.get(domain) ?? 0,
        totalPoints: Number(masteryByDomain.get(domain)?.totalPoints ?? pointsByDomain.get(domain) ?? 0),
        currentTier: masteryByDomain.get(domain)?.tier ?? resolveTier(pointsByDomain.get(domain) ?? 0),
        isNewTerritory: newTerritory.includes(domain),
      }))
      .sort((a, b) => b.pointsGained - a.pointsGained || a.displayName.localeCompare(b.displayName)),
    newTerritory,
    tierCrossings,
    recentFriendBridge,
    pendingFriendQuestions,
    isFirstCompletedRound,
    reminderPromptState,
    reminderInterstitialState,
    hasVerifiedEmail,
    refine,
    expansionOffer,
  };
}

type TouchedDomainForExpansion = {
  domain: string;
  territoryType: 'declared' | 'demonstrated' | null;
};

/**
 * Choose the single area to offer expansion for this round, or null. Two triggers
 * feed it (B-AREA-EXPANSION-01, A3 — one graduation per game):
 *   1. A thin declared area touched this game (the "graduation" trigger) — gated
 *      behind AREA_EXPANSION_THINNESS_TRIGGER_ENABLED, thinnest area wins.
 *   2. The supply-ceiling pending domain (the original trigger) as a fallback.
 * The thinness path honors the once-per-area stamp via getExpansionOfferedDomains.
 */
type ExpansionTrigger = 'thinness' | 'supply_ceiling';

async function selectExpansionSource(
  userId: string,
  touched: readonly TouchedDomainForExpansion[],
): Promise<{ domain: string; trigger: ExpansionTrigger } | null> {
  if (isAreaExpansionThinnessTriggerEnabled()) {
    const declared = touched.filter((t) => t.territoryType === 'declared').map((t) => t.domain);
    if (declared.length > 0) {
      const [depths, offered] = await Promise.all([
        getDurablePoolDepthForDomains(declared),
        getExpansionOfferedDomains(userId, declared),
      ]);
      const thinnest = selectThinnestEligibleArea(
        declared.map((domain) => ({ domain, poolDepth: depths.get(domain) ?? 0 })),
        narrowKbThinnessThreshold(),
        offered,
      );
      if (thinnest) return { domain: thinnest, trigger: 'thinness' };
    }
  }

  // Fallback: the supply-ceiling trigger (already excludes resolved offers).
  const pending = await getPendingExpansionDomains(userId);
  return pending[0] ? { domain: pending[0].canonicalSubcategory, trigger: 'supply_ceiling' } : null;
}

/**
 * Build the post-daily-Five expansion offer, or null when none is pending. The
 * source area comes from selectExpansionSource (a thin declared area touched this
 * game, else the supply-ceiling domain). Asks Haiku for wider siblings + broader
 * parents, drops any the player already follows, and only returns an offer when at
 * least one fresh candidate survives. Fails soft to null — an LLM outage or no
 * eligible area simply means no card this round.
 */
async function buildExpansionOffer(
  userId: string,
  touched: readonly TouchedDomainForExpansion[],
): Promise<ExpansionOffer | null> {
  const source = await selectExpansionSource(userId, touched);
  if (!source) return null;
  const { domain: sourceDomain, trigger } = source;

  const [mastery] = await db
    .select({ broadCategory: playerMastery.broadCategory })
    .from(playerMastery)
    .where(and(
      eq(playerMastery.userId, userId),
      eq(playerMastery.canonicalSubcategory, sourceDomain),
    ))
    .limit(1);

  // R1/R3: one offer carrying both a lateral "wider" set (siblings) and a
  // vertical "broader" set (one level up).
  const broad = mastery?.broadCategory ?? null;

  // Prefer the cached near-ness tree (D-NEARNESS-LADDER-HYBRID-01 D2 + §7). Its
  // siblings/cousins are the "wider" set, parents/grandparents the "broader" set,
  // and reading the cache replaces the two per-offer Haiku calls. D2: only surface
  // UNHELD near rungs — the held ones are already borrowed by supply (getHeldDomainKeys
  // is the C2 overlay). Falls back to the live suggest* calls when the tree is
  // empty or the flag is off, preserving today's behavior. All paths fail open to [].
  let wider: AdjacentDomainSuggestion[];
  let broader: AdjacentDomainSuggestion[];
  const cachedRungs = isNearnessTreeEnabled()
    ? await getCachedDomainRungs(sourceDomain).catch(() => [])
    : [];
  if (cachedRungs.length > 0) {
    const held = await getHeldDomainKeys(userId).catch(() => new Set<string>());
    const unheld = cachedRungs.filter((r) => !held.has(domainKey(r.domain)));
    const toSuggestion = (r: (typeof unheld)[number]): AdjacentDomainSuggestion => ({
      label: r.domain,
      broadCategory: r.broadCategory,
    });
    wider = unheld.filter((r) => r.rung === 'sibling' || r.rung === 'cousin').map(toSuggestion);
    broader = unheld.filter((r) => r.rung === 'parent' || r.rung === 'grandparent').map(toSuggestion);
  } else {
    [wider, broader] = await Promise.all([
      suggestAdjacentDomains(sourceDomain, broad),
      suggestBroaderDomains(sourceDomain, broad),
    ]);
  }

  // Drop anything the player already follows so the offer is always net-new, and
  // de-dupe by label across both lists (broader is listed first, so it wins ties).
  const activeInterests = await db
    .select({ domain: declaredInterests.domain })
    .from(declaredInterests)
    .where(and(eq(declaredInterests.userId, userId), eq(declaredInterests.isActive, true)));
  const have = new Set(activeInterests.map((row) => row.domain.trim().toLowerCase()));
  const seen = new Set<string>();
  const tagged: ExpansionCandidate[] = [
    ...broader.map((s) => ({ ...s, kind: 'broader' as const })),
    ...wider.map((s) => ({ ...s, kind: 'wider' as const })),
  ].filter((c) => {
    const key = c.label.trim().toLowerCase();
    if (have.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const candidates = capExpansionCandidates(tagged, 3);
  if (candidates.length === 0) return null;

  // Audit the expansion-offer funnel (eligible → shown → resolved). Fires each
  // time the card is actually surfaced on a summary (until the player resolves it).
  console.info('[expansion-offer] shown', {
    phase: 'shown',
    userId,
    sourceDomain,
    trigger,
    candidateCount: candidates.length,
    widerCount: candidates.filter((c) => c.kind === 'wider').length,
    broaderCount: candidates.filter((c) => c.kind === 'broader').length,
    // 'nearness-tree' = served from the cache (no per-offer Haiku calls, §7);
    // 'llm' = fell back to the live suggest* calls.
    candidateSource: cachedRungs.length > 0 ? 'nearness-tree' : 'llm',
  });

  return {
    sourceDomain,
    sourceDisplayName: displayNameForDomain(sourceDomain),
    candidates,
  };
}

/**
 * Cap the combined candidate list to a glanceable size while guaranteeing each
 * flavour that exists is represented (at least one broader, at least one wider),
 * then fill remaining slots broader-first. Keeps the chooser short without
 * silently hiding one whole direction.
 */
function capExpansionCandidates(items: ExpansionCandidate[], limit: number): ExpansionCandidate[] {
  const broader = items.filter((c) => c.kind === 'broader');
  const wider = items.filter((c) => c.kind === 'wider');
  const out: ExpansionCandidate[] = [];
  if (broader.length > 0) out.push(broader[0]);
  if (wider.length > 0 && out.length < limit) out.push(wider[0]);
  for (const candidate of [...broader, ...wider]) {
    if (out.length >= limit) break;
    if (!out.includes(candidate)) out.push(candidate);
  }
  return out.slice(0, limit);
}

async function computeReminderPromptState(
  userId: string,
  todayString: string,
  todayAnswered: number,
): Promise<{
  isFirstCompletedRound: boolean;
  reminderPromptState: 'show' | 'hidden';
  reminderInterstitialState: 'show' | 'hidden';
  hasVerifiedEmail: boolean;
}> {
  const hidden = {
    isFirstCompletedRound: false,
    reminderPromptState: 'hidden' as const,
    reminderInterstitialState: 'hidden' as const,
    hasVerifiedEmail: false,
  };

  // Today must have at least one answered slot to count as "completed" — the
  // reminder surfaces only arrive on a summary the player actually finished.
  if (todayAnswered <= 0) {
    return hidden;
  }

  // One read serves both reminder surfaces. The inline RoundReminderCard and the
  // D-REMINDER-INTERSTITIAL-01 interstitial are separately gated: the card is
  // first-completed-round only; the interstitial fires once ever (seen column
  // null), independent of first-round, and its skip must never write the card's
  // dismissed column (Decision D).
  const [user] = await db
    .select({
      smsOptIn: users.smsOptIn,
      emailOptIn: users.emailOptIn,
      emailVerified: users.emailVerified,
      email: users.email,
      pendingEmail: users.pendingEmail,
      reminderPromptDismissedAt: users.reminderPromptDismissedAt,
      reminderInterstitialSeenAt: users.reminderInterstitialSeenAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return hidden;
  }

  const hasVerifiedEmail = user.emailVerified && Boolean(user.email);

  // Inline RoundReminderCard gate — unchanged: opted in (either channel) or
  // dismissed retires it.
  const cardNotEngaged =
    user.smsOptIn === 'not_asked' &&
    user.emailOptIn === 'not_asked' &&
    user.reminderPromptDismissedAt === null;

  // Interstitial: once ever (seen column null) for a player who has not engaged
  // reminders at all. Also skips anyone with a signup already pending
  // verification — firing a loud full-screen ask at someone mid-signup is noise.
  // Deliberately NOT gated on first-completed-round: E1 collapsed the
  // first-session special case, so it can fire on the very first summary too.
  const reminderInterstitialState =
    user.reminderInterstitialSeenAt === null &&
    cardNotEngaged &&
    user.pendingEmail === null
      ? 'show'
      : 'hidden';

  // Did the user complete any earlier daily queue? A queue counts as completed
  // when any of its slots has answered=true. We only need to know whether such
  // a row exists for any prior date, not how many.
  const [prior] = await db
    .select({ id: dailyQueues.id })
    .from(dailyQueues)
    .where(and(
      eq(dailyQueues.userId, userId),
      ne(dailyQueues.queueDate, todayString),
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${dailyQueues.slots}) slot
        WHERE (slot->>'answered')::boolean IS TRUE
      )`,
    ))
    .limit(1);

  const isFirstCompletedRound = !prior;
  const reminderPromptState =
    isFirstCompletedRound && cardNotEngaged ? 'show' : 'hidden';

  return {
    isFirstCompletedRound,
    reminderPromptState,
    reminderInterstitialState,
    hasVerifiedEmail,
  };
}

// Both friend-facing recap signals come from a single feed read: the "Meanwhile"
// bridge (the most recent in-window friend event) and the pending-questions count
// that drives the sticky bar's nudge. The count sums the two direct surfaces —
// Broadcasts (friend created/shared) + Sent (friend sent you directly) — which are
// exactly the "For You"/"To You" pools the recap points the player back to.
async function getFriendSummarySignals(userId: string): Promise<{
  recentFriendBridge: RecentFriendBridge | null;
  pendingFriendQuestions: number;
}> {
  const mostRecentReset = new Date(getNextDailyResetBoundary().getTime() - ONE_DAY_MS);
  const page = await getFeedPagePayload(userId, { limit: 5, cursor: null, filter: 'all' });
  const pendingFriendQuestions =
    (page.meta.broadcasts_item_count ?? 0) + (page.meta.sent_item_count ?? 0);

  let recentFriendBridge: RecentFriendBridge | null = null;
  for (const item of page.items) {
    if (item.card_type === 'answered_by_you') continue;
    const eventAtRaw = typeof item.source_event_at === 'string' ? item.source_event_at : null;
    if (!eventAtRaw) continue;
    const eventAt = new Date(eventAtRaw);
    if (Number.isNaN(eventAt.getTime())) continue;
    if (eventAt < mostRecentReset) continue;
    recentFriendBridge = {
      friendName: item.source_friend_display_name ?? 'A friend',
      cardType: item.card_type,
      domainDisplayName: item.domain_pill ?? null,
    };
    break;
  }

  return { recentFriendBridge, pendingFriendQuestions };
}
