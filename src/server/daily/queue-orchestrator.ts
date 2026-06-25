import {
  buildAuthoredSlot,
  buildBotSlot,
  buildHouseSlot,
  buildPresenceSlot,
  carryForwardUntouchedDailyQueue,
  clearStaleShortTodayQueue,
  countDailyQueues,
  getKnowledgeBase,
  getTodaysDailyQueue,
  persistDailyQueue,
  pickEligibleAuthoredQuestions,
  pickHouseQuestions,
  getRecentAnsweredAnswerKeys,
  getRecentAnsweredEntities,
  type BonusPresence,
} from '@/server/db/queries/daily';
import { ANSWER_COOLDOWN_DAYS, makeAnswerCooldownGate } from '@/server/daily/answer-cooldown';
import { SUBJECT_COOLDOWN_DAYS, makeSubjectCooldownGate } from '@/server/daily/subject-cooldown';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { getFriendAndFoFUserIds } from '@/server/db/queries/friends';
import {
  getFriendDomainsForBonus,
  type FriendDomainCandidate,
} from '@/server/db/queries/friend-presence-domains';
import {
  generateBonusQuestionsForDomains,
  generateDailyQuestionsFromKnowledgeBase,
  type GeneratedQuestionRow,
} from '@/server/daily/generate-questions';
import { GENERATION_TIMEOUT_MS } from '@/lib/llm';
import { recalibrateDomainDifficultyToSupply } from '@/server/adaptive-difficulty';
import {
  DAILY_BONUS_SLOT_MAX,
  DAILY_QUEUE_MAX_PER_SUBCATEGORY,
  DAILY_QUEUE_MIN_SIZE,
  DAILY_QUEUE_SIZE,
  type QueueSlot,
} from '@/server/daily/types';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';
import { commitPendingRefineDecisions } from '@/server/refine/commit';
import { logLatency } from '@/server/telemetry';

export type DailyQueueFillErrorCode = 'no_knowledge_base' | 'generation_failed';

export class DailyQueueFillError extends Error {
  constructor(
    readonly code: DailyQueueFillErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DailyQueueFillError';
  }
}

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

type SubcategoryDiversityGate = {
  /**
   * Records and admits a pick while its canonical subcategory is still under the
   * cap; returns false (without recording) once the subcategory is full. A blank or
   * absent label is never blocked — the generic-subcategory gate owns those — and is
   * not counted toward any cap. Matching is case- and whitespace-insensitive.
   */
  admit: (subcategory: string | null | undefined) => boolean;
};

// Shared across all three core sources (authored → house → generated) so the cap is
// enforced over the WHOLE queue, not per-source. The cap is resolved PER subcategory
// (capForSubcategory receives the normalized key) so an explicit "often" preference
// from the Game settings page can lift the default cap for that subcategory — see
// DAILY_QUEUE_MAX_PER_SUBCATEGORY and the capForSubcategory builder in the caller.
function makeSubcategoryDiversityGate(
  capForSubcategory: (normalizedSubcategory: string) => number,
): SubcategoryDiversityGate {
  const counts = new Map<string, number>();
  return {
    admit(subcategory) {
      const key = (subcategory ?? '').trim().toLowerCase();
      if (!key) return true;
      const current = counts.get(key) ?? 0;
      if (current >= capForSubcategory(key)) return false;
      counts.set(key, current + 1);
      return true;
    },
  };
}

// Quality-first completeness loop. Rather than a single recovery pass, we keep
// generating + gating additional rounds until the core reaches DAILY_QUEUE_SIZE
// or we run out of budget. Each round runs the SAME strict quality/factual/dedup
// gates — we never relax them to hit the count — so a round is the honest cost of
// trying to surface another genuinely-good question.
//
// The platform function-duration ceiling this synchronous build runs under,
// used to gate the LLM rounds below so they never START work that can't finish
// before the function is killed. Defaults to the route's declared
// `maxDuration = 90` (s), which Pro/Enterprise honor.
//
// Background: on the Vercel **Hobby** plan every function is hard-capped at 60s
// regardless of the declared 90 — so a long build was killed mid-generation
// (confirmed in prod 2026-06-21: `POST /api/daily/queue` → 504, and the user was
// served the 3-question floor instead of five). The project has since upgraded
// past Hobby, so 90s is honored and the default below is correct; if it is ever
// run on a plan with a lower ceiling, set DAILY_BUILD_DURATION_BUDGET_MS to that
// ceiling (e.g. 60000) so the build degrades to a short-but-served queue instead
// of a 504. Keep this in lockstep with the route's `maxDuration`.
const FUNCTION_DURATION_BUDGET_MS = Number(
  process.env.DAILY_BUILD_DURATION_BUDGET_MS ?? 90_000,
);

// Headroom reserved AFTER the last LLM round for assembling + atomically
// persisting the queue before the ceiling.
const BUILD_PERSIST_MARGIN_MS = 8_000;

// Only START another LLM round (a top-up, or the +2 bonus) while it — taking up
// to GENERATION_TIMEOUT_MS — plus persistence can still finish before the
// platform kills the function. This is what keeps a short-but-served (≥ floor)
// queue from degrading into a 504 + a "forever" wait on Hobby.
const hasBudgetForAnotherRound = (elapsedMs: number) =>
  elapsedMs + GENERATION_TIMEOUT_MS + BUILD_PERSIST_MARGIN_MS <=
  FUNCTION_DURATION_BUDGET_MS;

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

// In-process single-flight de-dupe (B-DAILY-QUEUE-SWAP-01). The login pre-warm
// (after()) and the /daily page's synchronous POST routinely fire a build for
// the SAME user within seconds of each other. Coalescing concurrent same-user
// builds in this instance means the common race spends ONE generation instead
// of two — every caller awaits the same promise and observes the same queue.
//
// This is a cost optimization, not the correctness boundary: two builds on
// DIFFERENT instances skip this map entirely, and the real swap-proofing lives
// in persistDailyQueue's first-writer-wins ON CONFLICT DO NOTHING (so a
// cross-instance loser still can't overwrite the served queue). We deliberately
// do NOT use a DB advisory lock held across generation: the daily cron runs
// USER_CONCURRENCY=4 builds against the max:5 pool, and pinning a connection per
// build for its whole duration would starve that pool.
const inFlightFills = new Map<string, Promise<void>>();

export function fillDailyQueueForUser(userId: string): Promise<void> {
  const inFlight = inFlightFills.get(userId);
  if (inFlight) return inFlight;

  const promise = buildDailyQueueForUser(userId).finally(() => {
    // Clear on settle (success OR failure) so the next genuine build for this
    // user isn't blocked by a stale entry — a rejected build must be retryable.
    inFlightFills.delete(userId);
  });
  inFlightFills.set(userId, promise);
  return promise;
}

async function buildDailyQueueForUser(userId: string): Promise<void> {
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

  // First Daily Five seeding (PRD prompt 5). We've passed the existing-queue and
  // carry-forward early returns above, so if the user has never had a queue this
  // is genuinely their first. In random mode the generator then draws the palette
  // from declared interests in selection order (strong- vs light-signal). Never
  // let this count query block queue building — default to non-first-run on error.
  let isFirstRun = false;
  try {
    isFirstRun = (await countDailyQueues(userId)) === 0;
  } catch (error) {
    console.warn('[daily] countDailyQueues failed; treating as non-first-run', error);
  }

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

  // Intra-day diversity cap (D: "5-question botany run" / "3-Hamlet day"). One
  // shared gate enforces DAILY_QUEUE_MAX_PER_SUBCATEGORY across all three core
  // sources. Scale the BASE cap up when too few distinct subcategories are available
  // to field five under it, so a narrow knowledge base doesn't trigger pointless
  // top-up generation that can only ever come back over-cap; the reserve backfill
  // further down is the final safety net regardless of this estimate.
  const distinctAllowed = allowedSubcategories.size;
  const baseDiversityCap =
    distinctAllowed > 0
      ? Math.max(
          DAILY_QUEUE_MAX_PER_SUBCATEGORY,
          Math.ceil(DAILY_QUEUE_SIZE / distinctAllowed),
        )
      : DAILY_QUEUE_SIZE;

  // In concert with the Game settings page: a subcategory the player explicitly
  // marked "often" is EXEMPT from the diversity cap (bounded only by the queue
  // size), so the cap never throttles a topic the player deliberately asked to see
  // a lot of. The cap exists to break up runs the player did NOT request — and an
  // explicit "often" IS that request, so it wins. ("resting" is already removed from
  // allowedSubcategories upstream; "sometimes"/"blue_moon"/unset keep the base cap.)
  // Keys are lowercased to match how restingDomains is built above and how the gate
  // normalizes each subcategory.
  const oftenDomains = new Set(
    Object.entries(preferences.domainPreferenceFrequency ?? {})
      .filter(([, frequency]) => frequency === 'often')
      .map(([domain]) => domain.toLowerCase()),
  );
  const capForSubcategory = (normalizedSubcategory: string): number =>
    oftenDomains.has(normalizedSubcategory) ? DAILY_QUEUE_SIZE : baseDiversityCap;
  const diversityGate = makeSubcategoryDiversityGate(capForSubcategory);

  // Answer-cooldown gate (B-DEDUP-ANSWER-COOLDOWN, Tier 1). Deflects any pick —
  // authored, house, or generated — whose answer the player already gave within
  // ANSWER_COOLDOWN_DAYS, plus any two same-answer picks within this one build.
  // Deflected picks go to the SAME reserves as diversity deflections, so a
  // tapped-out knowledge base restores them rather than serving a short queue.
  const recentAnswerKeys =
    ANSWER_COOLDOWN_DAYS > 0
      ? await getRecentAnsweredAnswerKeys(userId, ANSWER_COOLDOWN_DAYS)
      : new Set<string>();
  const answerCooldownGate = makeAnswerCooldownGate(recentAnswerKeys);
  let deflectedForAnswerCooldown = 0;

  // Subject-cooldown gate (B-DEDUP-SUBJECT-COOLDOWN, Tier 2). Deflects a pick
  // whose subject OR answer names an entity the player recently touched (subjects
  // ∪ answers over SUBJECT_COOLDOWN_DAYS), spacing out same-subject saturation
  // even when the fact and the answer differ. Same reserve fallback as above.
  const recentEntities =
    SUBJECT_COOLDOWN_DAYS > 0
      ? await getRecentAnsweredEntities(userId, SUBJECT_COOLDOWN_DAYS)
      : new Set<string>();
  const subjectCooldownGate = makeSubjectCooldownGate(recentEntities);
  let deflectedForSubjectCooldown = 0;

  const socialGraph = await getFriendAndFoFUserIds(userId);
  const authoredAll = await pickEligibleAuthoredQuestions(
    userId,
    socialGraph,
    DAILY_QUEUE_SIZE,
    allowedSubcategories,
  );
  // Cap authored picks first (highest trust → first claim on each subcategory's
  // slots); deflected picks go to a reserve the backfill can draw on if the cap
  // would otherwise leave the queue short.
  const authoredReserve: typeof authoredAll = [];
  const authored = authoredAll.filter((pick) => {
    if (answerCooldownGate.blocks(pick.answerText)) {
      deflectedForAnswerCooldown += 1;
      authoredReserve.push(pick);
      return false;
    }
    if (subjectCooldownGate.blocks(pick.subjectEntity, pick.answerText)) {
      deflectedForSubjectCooldown += 1;
      authoredReserve.push(pick);
      return false;
    }
    if (!diversityGate.admit(pick.canonicalSubcategory)) {
      authoredReserve.push(pick);
      return false;
    }
    answerCooldownGate.record(pick.answerText);
    subjectCooldownGate.record(pick.subjectEntity, pick.answerText);
    return true;
  });

  // D-3: seed curated house/editorial questions into the core for the niches
  // friend content didn't cover, before falling back to LLM generation. Matched
  // by domain (the viewer's knowledge base), never the +2 friend-answer ranking.
  // House content does not enter the Feed and never occupies a +2 bonus slot.
  // Request against the CAPPED authored count so house can fill any slot the cap
  // freed, then run house through the same shared diversity gate.
  const housePicksAll = await pickHouseQuestions(
    userId,
    DAILY_QUEUE_SIZE - authored.length,
    allowedSubcategories,
  );
  const houseReserve: typeof housePicksAll = [];
  const housePicks = housePicksAll.filter((pick) => {
    if (answerCooldownGate.blocks(pick.answerText)) {
      deflectedForAnswerCooldown += 1;
      houseReserve.push(pick);
      return false;
    }
    if (subjectCooldownGate.blocks(pick.subjectEntity, pick.answerText)) {
      deflectedForSubjectCooldown += 1;
      houseReserve.push(pick);
      return false;
    }
    if (!diversityGate.admit(pick.canonicalSubcategory)) {
      houseReserve.push(pick);
      return false;
    }
    answerCooldownGate.record(pick.answerText);
    subjectCooldownGate.record(pick.subjectEntity, pick.answerText);
    return true;
  });

  // Under-difficulty reserve (soft difficulty-floor fallback). The generator
  // deflects good-but-too-easy questions here instead of dropping them; the final
  // backfill below draws on it only after every in-tier reserve is spent, so a
  // narrow tapped-out KB serves a full (if easier) Five rather than the floor.
  const underDifficultyReserve: GeneratedQuestionRow[] = [];

  const remaining = DAILY_QUEUE_SIZE - authored.length - housePicks.length;
  const generated =
    remaining > 0
      ? await generateDailyQuestionsFromKnowledgeBase(userId, overRequest(remaining), {
          firstRun: isFirstRun,
          underDifficultyReserve,
        })
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
  // Generated questions deflected ONLY by the intra-day diversity cap (not generic,
  // not duplicate). Held — not discarded — so the top-up loop can try to replace
  // them with a different subcategory, and the soft-cap backfill can restore them if
  // nothing diverse materializes rather than serving a short queue.
  const generatedReserve: typeof generated = [];
  let droppedDuplicates = 0;
  let droppedGeneric = 0;
  let deflectedForDiversity = 0;
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
    // Answer cooldown (Tier 1): a generated question whose answer the player gave
    // within the window — or already used earlier in this build — is spaced out
    // via the reserve like a diversity deflection.
    if (answerCooldownGate.blocks(question.answer)) {
      deflectedForAnswerCooldown += 1;
      generatedReserve.push(question);
      continue;
    }
    if (subjectCooldownGate.blocks(question.subjectEntity, question.answer)) {
      deflectedForSubjectCooldown += 1;
      generatedReserve.push(question);
      continue;
    }
    // Intra-day diversity cap, applied AFTER the generic + dedup gates so a deflected
    // pick is a genuine, distinct question we're merely spacing out — see the reserve
    // backfill below.
    if (!diversityGate.admit(question.canonicalSubcategory)) {
      deflectedForDiversity += 1;
      generatedReserve.push(question);
      continue;
    }
    answerCooldownGate.record(question.answer);
    subjectCooldownGate.record(question.subjectEntity, question.answer);
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
    DAILY_QUEUE_SIZE -
      (authored.length + housePicks.length + dedupedGenerated.length + topUpGenerated.length) >
      0 &&
    topUpRounds < MAX_TOP_UP_ROUNDS &&
    hasBudgetForAnotherRound(Date.now() - startedAt)
  ) {
    topUpRounds += 1;
    const roundShortfall =
      DAILY_QUEUE_SIZE -
      (authored.length + housePicks.length + dedupedGenerated.length + topUpGenerated.length);
    const extra = await generateDailyQuestionsFromKnowledgeBase(
      userId,
      overRequest(roundShortfall),
      { firstRun: isFirstRun, underDifficultyReserve },
    );
    let recoveredThisRound = 0;
    for (const question of extra) {
      if (isGenericSubcategory(question.canonicalSubcategory)) {
        droppedGeneric += 1;
        continue;
      }
      const key = normalize(question.questionText);
      if (seenTexts.has(key)) continue;
      seenTexts.add(key);
      if (answerCooldownGate.blocks(question.answer)) {
        deflectedForAnswerCooldown += 1;
        generatedReserve.push(question);
        continue;
      }
      if (subjectCooldownGate.blocks(question.subjectEntity, question.answer)) {
        deflectedForSubjectCooldown += 1;
        generatedReserve.push(question);
        continue;
      }
      if (!diversityGate.admit(question.canonicalSubcategory)) {
        deflectedForDiversity += 1;
        generatedReserve.push(question);
        continue;
      }
      answerCooldownGate.record(question.answer);
      subjectCooldownGate.record(question.subjectEntity, question.answer);
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

  // Soft-cap relaxation. If the diversity cap (on top of any honest under-yield)
  // left the core short of DAILY_QUEUE_SIZE, backfill from the reserve of
  // cap-deflected picks — authored first (vetted, highest trust), then house, then
  // generated — until we're full or the reserve runs dry. This is what makes the cap
  // SOFT: it only ever DIVERSIFIES a queue that had the material to stay full. A
  // knowledge base too narrow to field five distinct subcategories degrades to
  // exactly the queue it would have built without the cap — never shorter, and never
  // a spurious generation_failed below the floor.
  const authoredBackfill: typeof authored = [];
  const houseBackfill: typeof housePicks = [];
  const generatedBackfill: typeof generatedForQueue = [];
  let backfillShortfall =
    DAILY_QUEUE_SIZE - (authored.length + housePicks.length + generatedForQueue.length);
  for (const pick of authoredReserve) {
    if (backfillShortfall <= 0) break;
    authoredBackfill.push(pick);
    backfillShortfall -= 1;
  }
  for (const pick of houseReserve) {
    if (backfillShortfall <= 0) break;
    houseBackfill.push(pick);
    backfillShortfall -= 1;
  }
  for (const question of generatedReserve) {
    if (backfillShortfall <= 0) break;
    generatedBackfill.push(question);
    backfillShortfall -= 1;
  }
  const diversityBackfilled =
    authoredBackfill.length + houseBackfill.length + generatedBackfill.length;

  // Final fallback: under-difficulty questions (good, just easier than the
  // requested tier). Tapped ONLY after every in-tier reserve above is exhausted,
  // so difficulty integrity holds until a short queue is the only alternative.
  // These never passed through the generated-intake loop's generic/text-dedup, so
  // re-apply both guards here before one can become a slot.
  const underDifficultyBackfill: GeneratedQuestionRow[] = [];
  for (const question of underDifficultyReserve) {
    if (backfillShortfall <= 0) break;
    if (isGenericSubcategory(question.canonicalSubcategory)) continue;
    const key = normalize(question.questionText);
    if (seenTexts.has(key)) continue;
    seenTexts.add(key);
    underDifficultyBackfill.push(question);
    backfillShortfall -= 1;
  }

  // Supply-side difficulty correction. Having to serve below-tier questions from
  // the under-difficulty reserve is proof the domain couldn't field the tier we
  // asked for, so pull its stored difficulty back down to what we could actually
  // deliver — next run requests the sustainable tier instead of re-gating the same
  // too-hard ask. Best-effort: never let a difficulty write break queue assembly.
  if (underDifficultyBackfill.length > 0) {
    try {
      await recalibrateDomainDifficultyToSupply(
        userId,
        underDifficultyBackfill.map((question) => ({
          domain: question.canonicalSubcategory,
          deliveredTier: question.difficultyEstimate,
        })),
      );
    } catch (error) {
      console.error('[daily orchestrator] supply-side difficulty recalibration failed', error);
    }
  }

  const coreAuthored = [...authored, ...authoredBackfill];
  const coreHouse = [...housePicks, ...houseBackfill];
  const coreGenerated = [...generatedForQueue, ...generatedBackfill, ...underDifficultyBackfill];

  const achieved = coreAuthored.length + coreHouse.length + coreGenerated.length;

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
      baseDiversityCap,
      oftenDomains: oftenDomains.size,
      deflectedForDiversity,
      deflectedForAnswerCooldown,
      deflectedForSubjectCooldown,
      diversityBackfilled,
      underDifficultyReserve: underDifficultyReserve.length,
      underDifficultyBackfilled: underDifficultyBackfill.length,
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
      baseDiversityCap,
      oftenDomains: oftenDomains.size,
      deflectedForDiversity,
      deflectedForAnswerCooldown,
      deflectedForSubjectCooldown,
      diversityBackfilled,
      underDifficultyReserve: underDifficultyReserve.length,
      underDifficultyBackfilled: underDifficultyBackfill.length,
      knowledgeBaseDomains: knowledgeBase.length,
      domainMode: preferences.domainMode,
      selectedDomains: preferences.selectedDomains.length,
      elapsedMs: Date.now() - startedAt,
    });
  }

  // Assemble the COMPLETE queue (core + bonus) in memory, then persist it as a
  // SINGLE atomic write (persistDailyQueue). The prior approach persisted each
  // slot in its own transaction and the +2 bonus in a separate later pass, which
  // left DailyQueue.slots observable in partial states for the whole build — a
  // concurrent GET could read 2 of 6 slots and the player would play that partial
  // set to "completion" (B-DAILY-PARTIAL-QUEUE-01). Building the full array first
  // means a reader sees either the pre-build state or the whole queue, never a
  // prefix. Source order (authored → house → generated) and the defensive slices
  // (core never exceeds DAILY_QUEUE_SIZE) are unchanged.
  const slots: QueueSlot[] = [];
  const generatedQuestionIds: string[] = [];
  let position = 0;
  for (const pick of coreAuthored.slice(0, DAILY_QUEUE_SIZE - position)) {
    slots.push(buildAuthoredSlot(pick, position));
    position += 1;
  }
  for (const pick of coreHouse.slice(0, DAILY_QUEUE_SIZE - position)) {
    slots.push(buildHouseSlot(pick, position));
    position += 1;
  }
  for (const question of coreGenerated.slice(0, DAILY_QUEUE_SIZE - position)) {
    slots.push(buildBotSlot(question, position));
    generatedQuestionIds.push(question.id);
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
  // Resting domains are excluded from the +2 pool too, so "This is {Name}'s bag
  // but not mine" (which parks the domain in Resting) stops it surfacing as a
  // bonus, not just in the core five.
  //
  // Generated BEFORE the single persist so the whole queue (core + bonus) lands
  // atomically. Wrapped so a bonus-generation failure degrades to a core-only
  // queue instead of losing the entire build.
  try {
    const bonusDomains = await getFriendDomainsForBonus(
      userId,
      DAILY_BONUS_SLOT_MAX,
      restingDomains,
    );
    // Gate the bonus LLM call on the remaining function budget. The +2 is purely
    // additive, so when little time is left (e.g. a slow core build near the
    // ceiling) skipping it lets the core queue still persist instead of risking a
    // mid-bonus kill that would lose the whole build.
    if (bonusDomains.length > 0 && hasBudgetForAnotherRound(Date.now() - startedAt)) {
      const presenceByDomain = new Map(
        bonusDomains.map((candidate) => [candidate.domain.toLowerCase(), candidate]),
      );
      const generatedBonus = await generateBonusQuestionsForDomains(
        userId,
        bonusDomains.map((candidate) => candidate.domain),
      );
      for (const { domain, question } of generatedBonus) {
        const candidate = presenceByDomain.get(domain.toLowerCase());
        slots.push(buildPresenceSlot(question, toBonusPresence(candidate), position));
        generatedQuestionIds.push(question.id);
        position += 1;
      }
    }
  } catch (error) {
    console.warn('[daily/queue-orchestrator] +2 bonus generation failed; serving core only', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await persistDailyQueue(userId, slots, generatedQuestionIds);

  // Server timing for the slow path. Logged only when a full build actually ran
  // (the existing-queue / carry-forward early returns above never reach here),
  // so `[latency] daily_queue_generated` measures real generation cost — the
  // long pole behind the /daily loading screen — across every caller (cron,
  // synchronous POST, and the post-login/onboarding pre-warm).
  logLatency('daily_queue_generated', Date.now() - startedAt, {
    slots: slots.length,
    top_up_rounds: topUpRounds,
    first_run: isFirstRun,
  });
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
