import {
  carryForwardUntouchedDailyQueue,
  clearStaleShortTodayQueue,
  createDailyQueueItem,
  createDailyQueueItemFromAuthored,
  createDailyQueueItemFromHouse,
  createDailyQueueItemFromPresence,
  getKnowledgeBase,
  getTodaysDailyQueue,
  pickEligibleAuthoredQuestions,
  pickHouseQuestions,
  type BonusPresence,
} from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { getFriendAndFoFUserIds } from '@/server/db/queries/friends';
import {
  getFriendDomainsForBonus,
  type FriendDomainCandidate,
} from '@/server/db/queries/friend-presence-domains';
import {
  generateBonusQuestionsForDomains,
  generateDailyQuestionsFromKnowledgeBase,
} from '@/server/daily/generate-questions';
import { DAILY_BONUS_SLOT_MAX, DAILY_QUEUE_MIN_SIZE, DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';
import { commitPendingRefineDecisions } from '@/server/refine/commit';

export type DailyQueueFillErrorCode = 'no_knowledge_base' | 'generation_failed';

export class DailyQueueFillError extends Error {
  constructor(readonly code: DailyQueueFillErrorCode, message: string) {
    super(message);
    this.name = 'DailyQueueFillError';
  }
}

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

// Quality-first completeness loop. Rather than a single recovery pass, we keep
// generating + gating additional rounds until the core reaches DAILY_QUEUE_SIZE
// or we run out of budget. Each round runs the SAME strict quality/factual/dedup
// gates — we never relax them to hit the count — so a round is the honest cost of
// trying to surface another genuinely-good question.
//
// Only START a new round while this much of the function budget is still unspent.
// A round can take up to GENERATION_TIMEOUT_MS (35s); gating each round's start on
// elapsed time, with the route's 90s maxDuration, leaves a worst-case round plus
// slot persistence (and a degraded-but-skippable +2 bonus) comfortably inside the
// platform ceiling. Set well below maxDuration so the request never dies mid-build.
const TOP_UP_TIME_BUDGET_MS = 45_000;

// Hard cap on top-up rounds, independent of the time budget — a backstop against
// a pathological domain that keeps generating questions the gates fully reject.
// Combined with the "a round that recovers nothing breaks the loop" guard below,
// this keeps a tapped-out knowledge base from burning the whole time budget (and
// LLM spend) on rounds that can never reach the target.
const MAX_TOP_UP_ROUNDS = 4;

// The generator's quality/factual/history-dedup gates routinely drop ~half (and
// for some niche or deep-history domains far more) of each batch. Requesting
// exactly the gap therefore lands short. Ask for a multiple so enough survive
// the gates; excess survivors are trimmed to DAILY_QUEUE_SIZE downstream.
//
// Over-requesting is only safe because generateDailyQuestionsFromKnowledgeBase
// now splits the request into GENERATION_CHUNK_SIZE-capped PARALLEL Sonnet calls
// — each reply stays well under the generator's 2000-token cap, so a large count
// no longer truncates the JSON to zero (the 2026-05-30 over-provision regression)
// and total latency stays at one chunk. The graceful-degrade below still backstops
// any residual shortfall.
const GENERATION_OVERPROVISION = 2;
const overRequest = (needed: number) =>
  Math.min(needed * GENERATION_OVERPROVISION, DAILY_QUEUE_SIZE * 2);

export async function fillDailyQueueForUser(userId: string): Promise<void> {
  const startedAt = Date.now();

  // Commit point for Refine Your Game: staged decisions from the prior daily's
  // summary become permanent when the player builds their next daily. Must run
  // before the early returns below so it isn't skipped on a carry-forward day.
  // Never let a refine-commit failure block queue building.
  try {
    await commitPendingRefineDecisions(userId);
  } catch (error) {
    console.warn('[daily] commitPendingRefineDecisions failed', error);
  }

  const existing = await getTodaysDailyQueue(userId);
  if (existing && asQueueSlots(existing.slots).length > 0) {
    // A populated today-queue normally stands. The exception is a SHORT,
    // UNTOUCHED queue that carryForwardUntouchedDailyQueue rolled over from a
    // prior day: that freezes a one-off low-yield day (e.g. the 2026-05-29
    // over-provision truncation that built a 3-of-5 queue) and re-dates it
    // forward unchanged every day until the user plays it. clearStaleShort-
    // TodayQueue drops only that case (a short queue actually built today is
    // left alone so we don't re-bill the LLM on every load) and lets us fall
    // through to regenerate a fresh, full set.
    if (!(await clearStaleShortTodayQueue(userId))) return;
  }

  // Before billing the LLM for a new set, roll a previous *unplayed* queue
  // forward to today. The cron builds a queue for every onboarded user daily
  // with no activity filter, so an absent user would otherwise accrue a fresh
  // generation every day for questions they never opened. Their last queue is
  // still sitting unplayed; re-dating it gives them the same five at zero cost.
  // A played prior queue is left alone, so engaged users still get a fresh set.
  if (await carryForwardUntouchedDailyQueue(userId)) return;

  const [knowledgeBase, preferences] = await Promise.all([
    getKnowledgeBase(userId),
    getDailyPreferences(userId),
  ]);
  if (knowledgeBase.length === 0) {
    throw new DailyQueueFillError(
      'no_knowledge_base',
      'Add declared interests before generating Daily Five.',
    );
  }
  if (preferences.domainMode === 'custom' && preferences.selectedDomains.length === 0) {
    throw new DailyQueueFillError(
      'no_knowledge_base',
      'Choose at least one domain before starting a custom Daily Five.',
    );
  }

  // Prefer vetted user-authored questions, prioritised by friends-of-friends,
  // then top up the remaining slots with LLM-generated questions. The
  // QueueSlot schema already supports both bot and friend sources
  // (src/server/daily/types.ts), so this is a picker change — no slot-shape
  // migration required.
  //
  // Constrain authored AND house picks to the viewer's effective knowledge
  // base — in custom mode that's the explicit selectedDomains list, in random
  // mode it's the full knowledge base (which getKnowledgeBase already filters
  // against userDomainExclusions). Without this, the authored picker surfaced
  // any vetted public question regardless of the viewer's declared or
  // demonstrated interests.
  //
  // In random mode, also drop domains the player parked in "Resting" on the
  // Game settings page. "Resting" means "won't be asked for now" (see the
  // territory setup zones), and the LLM generator already honors it in both
  // modes — but the authored/house pickers only filtered by this allow-set, so
  // a rested category could still leak into the Daily Five via a vetted friend
  // or house question. Custom mode needs no extra handling here: buildSavePayload
  // excludes rested domains from selectedDomains upstream, so they're already out.
  const restingDomains = new Set(
    Object.entries(preferences.domainPreferenceFrequency ?? {})
      .filter(([, frequency]) => frequency === 'resting')
      .map(([domain]) => domain.toLowerCase()),
  );
  const allowedSubcategories: ReadonlySet<string> = new Set(
    preferences.domainMode === 'custom'
      ? preferences.selectedDomains
      : knowledgeBase
          .map((domain) => domain.domain)
          .filter((domain) => !restingDomains.has(domain.toLowerCase())),
  );

  const socialGraph = await getFriendAndFoFUserIds(userId);
  const authored = await pickEligibleAuthoredQuestions(
    userId,
    socialGraph,
    DAILY_QUEUE_SIZE,
    allowedSubcategories,
  );

  // D-3: seed curated house/editorial questions into the core for the niches
  // friend content didn't cover, before falling back to LLM generation. Matched
  // by domain (the viewer's knowledge base), never the +2 friend-answer ranking.
  // House content does not enter the Feed and never occupies a +2 bonus slot.
  const housePicks = await pickHouseQuestions(
    userId,
    DAILY_QUEUE_SIZE - authored.length,
    allowedSubcategories,
  );

  const remaining = DAILY_QUEUE_SIZE - authored.length - housePicks.length;
  const generated = remaining > 0
    ? await generateDailyQuestionsFromKnowledgeBase(userId, overRequest(remaining))
    : [];

  // Cross-source dedup by normalized question text. The authored picker
  // dedupes by question_id against past queues, and the generator has its
  // own batch/history dedup — but neither knows about the other, so the
  // same prompt can land in two slots of the same queue (e.g. an authored
  // "Apples are in what plant family?" alongside an LLM-generated one).
  const seenTexts = new Set<string>();
  const normalize = (text: string) => text.trim().toLowerCase();
  for (const pick of authored) {
    seenTexts.add(normalize(pick.questionText));
  }
  for (const pick of housePicks) {
    seenTexts.add(normalize(pick.questionText));
  }
  const dedupedGenerated: typeof generated = [];
  let droppedDuplicates = 0;
  let droppedGeneric = 0;
  for (const question of generated) {
    // Drop bucket-level domains ("general"/"trivia"/short labels) BEFORE the
    // shortfall count below, so a generic pick is treated as a missing slot the
    // top-up can backfill — rather than persisting it and letting the read path
    // (api/daily/queue) silently filter it out, leaving the user one short.
    if (isGenericSubcategory(question.canonicalSubcategory)) {
      droppedGeneric += 1;
      continue;
    }
    const key = normalize(question.questionText);
    if (seenTexts.has(key)) {
      droppedDuplicates += 1;
      continue;
    }
    seenTexts.add(key);
    dedupedGenerated.push(question);
  }
  if (droppedDuplicates > 0) {
    console.warn('[daily/queue-orchestrator] dropped duplicate generated questions', {
      userId,
      droppedDuplicates,
      authoredCount: authored.length,
      generatedCount: generated.length,
    });
  }

  // If the first pass came up short — the LLM returned fewer usable questions
  // than requested, or the quality/dedup gates dropped some — keep topping up in
  // bounded rounds until the core reaches DAILY_QUEUE_SIZE or we run out of
  // budget/rounds. A transient slow or partial Anthropic response (e.g. prod
  // request 9lssf-…, where one Sonnet call ran ~34s and the queue fell one slot
  // short) otherwise 503s the entire Daily Five even though most slots generated
  // fine. Each round is gated on the remaining time budget so the recovery can't
  // push the request past the route's maxDuration.
  //
  // The loop is the "quality-first, willing-to-wait" lever: it never relaxes the
  // gates to pad the count — it just spends more time/LLM calls to give more
  // genuinely-good questions a chance to survive. It stops early (rather than
  // burning the whole budget) the moment a round recovers nothing, which is the
  // signal that this knowledge base is tapped out for today.
  const topUpGenerated: typeof dedupedGenerated = [];
  let topUpRounds = 0;
  while (
    DAILY_QUEUE_SIZE - (authored.length + housePicks.length + dedupedGenerated.length + topUpGenerated.length) > 0 &&
    topUpRounds < MAX_TOP_UP_ROUNDS &&
    Date.now() - startedAt < TOP_UP_TIME_BUDGET_MS
  ) {
    topUpRounds += 1;
    const roundShortfall =
      DAILY_QUEUE_SIZE - (authored.length + housePicks.length + dedupedGenerated.length + topUpGenerated.length);
    const extra = await generateDailyQuestionsFromKnowledgeBase(userId, overRequest(roundShortfall));
    let recoveredThisRound = 0;
    for (const question of extra) {
      if (isGenericSubcategory(question.canonicalSubcategory)) {
        droppedGeneric += 1;
        continue;
      }
      const key = normalize(question.questionText);
      if (seenTexts.has(key)) continue;
      seenTexts.add(key);
      topUpGenerated.push(question);
      recoveredThisRound += 1;
    }
    if (recoveredThisRound > 0) {
      console.info('[daily/queue-orchestrator] topped up short queue', {
        userId,
        round: topUpRounds,
        roundShortfall,
        recovered: recoveredThisRound,
        topUpTotal: topUpGenerated.length,
      });
    } else {
      // Nothing new survived the gates this round — the domain pool is exhausted
      // for now. Further rounds would just re-spend the budget for the same null
      // result, so stop and let the floor/graceful-degrade below decide.
      console.info('[daily/queue-orchestrator] top-up round recovered nothing; stopping', {
        userId,
        round: topUpRounds,
        roundShortfall,
      });
      break;
    }
  }

  const generatedForQueue = [...dedupedGenerated, ...topUpGenerated];
  const achieved = authored.length + housePicks.length + generatedForQueue.length;

  // Graceful degrade WITH A FLOOR. Some niche domains have very low generation
  // yield — the quality/factual/dedup gates correctly reject most of each batch —
  // so even over-provisioned generation plus the top-up loop above can land short.
  // A shorter Daily Five (the good questions we did get) beats a 503 — but only
  // down to DAILY_QUEUE_MIN_SIZE. A one- or two-question "Daily Five" is a broken
  // session, not a degraded one, so below the floor we fail the build instead of
  // persisting it: /api/daily/queue surfaces a retryable 503 + the fill-error UI,
  // and the daily cron retries for a full set on later days. The play flow and
  // home completion are slot-driven (isRoundComplete + progress read the ACTUAL
  // slot count), so a queue between the floor and DAILY_QUEUE_SIZE renders and
  // completes correctly — no "round ends early with blank dots".
  //
  // We never relax the gates to climb to the floor: a sub-floor result means the
  // honest, gated yield was genuinely too low, which is a retry, not filler.
  if (achieved < DAILY_QUEUE_MIN_SIZE) {
    console.warn('[daily/queue-orchestrator] generation_failed (below minimum usable questions)', {
      userId,
      achieved,
      floor: DAILY_QUEUE_MIN_SIZE,
      authoredCount: authored.length,
      housePicks: housePicks.length,
      knowledgeBaseDomains: knowledgeBase.length,
      generatedRaw: generated.length,
      dedupedGenerated: dedupedGenerated.length,
      topUpRecovered: topUpGenerated.length,
      topUpRounds,
      droppedDuplicates,
      droppedGeneric,
      domainMode: preferences.domainMode,
      selectedDomains: preferences.selectedDomains.length,
      elapsedMs: Date.now() - startedAt,
    });
    throw new DailyQueueFillError(
      'generation_failed',
      "Today's Daily Five is taking longer than usual.",
    );
  }
  if (achieved < DAILY_QUEUE_SIZE) {
    // Persisted a short queue. Log the cause so it's still visible/actionable:
    // thin KB (knowledgeBaseDomains) vs low LLM yield (generatedRaw) vs
    // aggressive dedup (droppedDuplicates) vs skipped top-up (elapsedMs).
    console.warn('[daily/queue-orchestrator] persisted short queue', {
      userId,
      achieved,
      needed: DAILY_QUEUE_SIZE,
      floor: DAILY_QUEUE_MIN_SIZE,
      authoredCount: authored.length,
      generatedRaw: generated.length,
      dedupedGenerated: dedupedGenerated.length,
      topUpRecovered: topUpGenerated.length,
      topUpRounds,
      droppedDuplicates,
      droppedGeneric,
      knowledgeBaseDomains: knowledgeBase.length,
      domainMode: preferences.domainMode,
      selectedDomains: preferences.selectedDomains.length,
      elapsedMs: Date.now() - startedAt,
    });
  }

  let position = 0;
  for (const pick of authored) {
    await createDailyQueueItemFromAuthored(userId, pick, position);
    position += 1;
  }
  for (const pick of housePicks.slice(0, DAILY_QUEUE_SIZE - position)) {
    await createDailyQueueItemFromHouse(userId, pick, position);
    position += 1;
  }
  for (const question of generatedForQueue.slice(0, DAILY_QUEUE_SIZE - position)) {
    await createDailyQueueItem(userId, question.id, position);
    position += 1;
  }

  // Daily Five +2 (D-4 §B, the territory ∪ activity reframe). Append up to
  // DAILY_BONUS_SLOT_MAX bonus slots, each a FRESHLY GENERATED accessible
  // question in a domain drawn from the durable territory + recent activity of
  // the people the viewer follows, ranked Both > territory-only > activity-only.
  // Purely additive: NOT counted toward DAILY_QUEUE_SIZE / the achieved backstop,
  // never triggers the N<5 generation top-up, and never pads with the viewer's
  // own domains. If no friend domains qualify (or generation misses) we append
  // fewer slots (graceful shrink), yielding a 5–7 slot queue. The +2 serves only
  // fresh questions — never a friend's literal answered question (those live
  // behind the Lately milestone click-through, D-4 §A).
  const bonusDomains = await getFriendDomainsForBonus(userId, DAILY_BONUS_SLOT_MAX);
  if (bonusDomains.length > 0) {
    const presenceByDomain = new Map(
      bonusDomains.map((candidate) => [candidate.domain.toLowerCase(), candidate]),
    );
    const generatedBonus = await generateBonusQuestionsForDomains(
      userId,
      bonusDomains.map((candidate) => candidate.domain),
    );
    for (const { domain, question } of generatedBonus) {
      const candidate = presenceByDomain.get(domain.toLowerCase());
      await createDailyQueueItemFromPresence(userId, question.id, toBonusPresence(candidate), position);
      position += 1;
    }
  }
}

// Map a ranked friend-domain candidate to the slot's presence attribution: the
// most-recent surfacing friend by name, plus a count of any others ("{Name} and
// others").
function toBonusPresence(candidate: FriendDomainCandidate | undefined): BonusPresence {
  const primary = candidate?.presenceSources[0];
  return {
    sourceId: primary?.userId ?? '',
    sourceName: primary?.displayName ?? null,
    extraCount: candidate ? Math.max(0, candidate.presenceSources.length - 1) : 0,
  };
}
