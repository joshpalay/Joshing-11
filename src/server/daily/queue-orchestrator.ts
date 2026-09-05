import { after } from 'next/server';
import {
  buildAuthoredSlot,
  buildBotSlot,
  buildHouseSlot,
  buildReturnSlot,
  resolveCreatorNames,
  carryForwardUntouchedDailyQueue,
  carryForwardQueueWithSlots,
  clearStaleShortTodayQueue,
  countDailyQueues,
  getExcludedKnowledgeDomains,
  getKnowledgeBase,
  getPriorInWindowDailyQueue,
  getTodaysDailyQueue,
  createDailyQueueItemFromPresence,
  persistDailyQueue,
  pickEligibleAuthoredQuestions,
  pickHouseQuestions,
  getRecentAnsweredAnswerKeys,
  getRecentAnsweredEntities,
  type BonusPresence,
} from '@/server/db/queries/daily';
import { ANSWER_COOLDOWN_DAYS, makeAnswerCooldownGate } from '@/server/daily/answer-cooldown';
import {
  isMissedReturnEnabled,
  selectReturnCandidates,
} from '@/server/daily/missed-return';
import {
  getEligibleReturnCandidates,
  isMissedReturnEnabledForUser,
  loadReturnQuestions,
  recordReturnServed,
} from '@/server/db/queries/missed-return';
import { SUBJECT_COOLDOWN_DAYS, makeSubjectCooldownGate } from '@/server/daily/subject-cooldown';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { getFriendAndFoFUserIds } from '@/server/db/queries/friends';
import { EMPTY_HIDDEN_IDS, getHiddenQuestionIds } from '@/server/db/queries/hidden-questions';
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
import {
  recalibrateDomainDifficultyToSupply,
  relaxDomainDifficultyOnStarvation,
} from '@/server/adaptive-difficulty';
import {
  DAILY_BONUS_SLOT_MAX,
  DAILY_QUEUE_MAX_PER_SUBCATEGORY,
  DAILY_QUEUE_MIN_SIZE,
  DAILY_QUEUE_SIZE,
  type QueueSlot,
} from '@/server/daily/types';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';
import { verifyGateThinDeclared } from '@/server/daily/verify-gate-thin';
import { commitPendingRefineDecisions } from '@/server/refine/commit';
import { logLatency } from '@/server/telemetry';
import {
  noteFinalSize,
  noteGatedFloorReached,
  noteOutcome,
  currentBuildContext,
  noteBorrowedDomain,
  noteDeferred,
  noteDeferredContinuation,
  noteDeferredDomainCount,
  noteQueuePersisted,
  noteRound,
  runBuildWithMetrics,
} from '@/server/daily/build-context';
import {
  finalizeDailyBuildMetric,
  insertDailyBuildMetric,
} from '@/server/db/queries/daily-build-metrics';

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

// Background builds (the daily cron) run under a route whose maxDuration is 300s,
// so they can afford a LONGER top-up loop than the user-facing synchronous POST.
// The 90s sync ceiling is why a struggling build stops at 4 instead of 5: after
// the first pass (~50-70s) there isn't budget to START another top-up round
// (elapsed + GENERATION_TIMEOUT_MS + margin > 90s), so it persists the short queue
// (the measured "four questions" case). Giving the non-interactive build ~180s
// lets that extra round run and reach DAILY_QUEUE_SIZE. The sync + pre-warm paths
// keep the 90s budget for perceived latency; carry-forward means most users are
// served the cron's pre-built (full) queue anyway. Env-tunable; keep it under the
// cron route's maxDuration (300s) with margin for concurrency.
const BACKGROUND_DURATION_BUDGET_MS = Number(
  process.env.DAILY_BUILD_BG_DURATION_BUDGET_MS ?? 180_000,
);

// Headroom reserved AFTER the last LLM round for assembling + atomically
// persisting the queue before the ceiling.
const BUILD_PERSIST_MARGIN_MS = 8_000;

// Only START another LLM round (a top-up, or the +2 bonus) while it — taking up
// to GENERATION_TIMEOUT_MS — plus persistence can still finish before the
// platform kills the function. This is what keeps a short-but-served (≥ floor)
// queue from degrading into a 504 + a "forever" wait on Hobby.
const hasBudgetForAnotherRound = (elapsedMs: number, budgetMs: number) =>
  elapsedMs + GENERATION_TIMEOUT_MS + BUILD_PERSIST_MARGIN_MS <= budgetMs;

// Hard cap on top-up rounds, independent of the time budget — a backstop against
// a pathological domain that keeps generating questions the gates fully reject.
// Combined with the "a round that recovers nothing breaks the loop" guard below,
// this keeps a tapped-out knowledge base from burning the whole time budget (and
// LLM spend) on rounds that can never reach the target.
const MAX_TOP_UP_ROUNDS = 4;

// Mirrors GENERATION_CHUNK_SIZE in generate-questions.ts. Used only to record
// how many parallel chunks a round dispatched (A0 telemetry) — never to decide
// anything. Kept local rather than imported so telemetry can't couple the
// orchestrator to the generator's internals.
const GENERATION_CHUNK_SIZE_HINT = 3;

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

function isDailyTopUpCarryForwardEnabled(): boolean {
  const raw = process.env.DAILY_TOPUP_CARRYFORWARD_ENABLED?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

// Default ON (kill-switch). On a SHORT top-up round, exclude the domains already
// filling the queue so the re-generation reaches the user's OTHER selected
// domains instead of re-sampling the same exhausted few — the "13 interests but a
// 4-question queue" case, where the favorite domains are mined out and the dedup
// gates reject the repeats. Also a small cost win: a dry top-up round that would
// recover nothing (and still bill a Sonnet call) instead draws fresh material.
// Set DAILY_TOPUP_BROADEN_ENABLED=false to disable.
function isDailyTopUpBroadenEnabled(): boolean {
  const raw = process.env.DAILY_TOPUP_BROADEN_ENABLED?.trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
}

const normalizeQueueText = (text: string) => text.trim().toLowerCase();

/**
 * Pure: merge a prior queue's carried (unplayed) slots with freshly generated
 * top-up questions into a single re-indexed slot array, capped at DAILY_QUEUE_SIZE.
 * Carried slots come first (the user resumes where they left off) and are re-indexed
 * from 0; fresh questions fill the remainder, skipping generics and any whose text
 * duplicates a carried slot. Returns the merged slots plus the ids of the fresh
 * questions actually placed (to flag usedInQueue). Exported for unit tests.
 */
export function mergeCarriedWithFresh(
  carried: QueueSlot[],
  fresh: GeneratedQuestionRow[],
): { merged: QueueSlot[]; newGeneratedIds: string[] } {
  const seen = new Set(carried.map((slot) => normalizeQueueText(slot.question_text)));
  const merged: QueueSlot[] = carried
    .slice(0, DAILY_QUEUE_SIZE)
    .map((slot, index) => ({ ...slot, slot_index: index }));
  const newGeneratedIds: string[] = [];
  for (const question of fresh) {
    if (merged.length >= DAILY_QUEUE_SIZE) break;
    if (isGenericSubcategory(question.canonicalSubcategory)) continue;
    const key = normalizeQueueText(question.questionText);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(buildBotSlot(question, merged.length));
    newGeneratedIds.push(question.id);
  }
  return { merged, newGeneratedIds };
}

/**
 * Top-up carry-forward — "don't regenerate when unplayed questions remain."
 *
 * carryForwardUntouchedDailyQueue only re-dates a FULL, completely untouched prior
 * queue. A PARTIAL (some answered/skipped) or SHORT (<5) prior queue otherwise
 * falls through to a fresh full regeneration EVERY day, re-billing the LLM and
 * discarding the questions the user never played. Instead (flag-gated), keep the
 * prior queue's UNPLAYED slots and generate only enough fresh questions to refill
 * to DAILY_QUEUE_SIZE, then land the merged set on today's date IN PLACE via
 * carryForwardQueueWithSlots (so the carried questions move out of catch-up rather
 * than double-surfacing). Returns true when it built today's queue (caller returns
 * early). Composes with the narrow-KB guard: for a tapped-out thin domain the guard
 * makes generation return nothing, so this simply carries the unplayed set forward
 * at zero LLM cost. Default OFF; fail-open (any error → false → normal fresh build).
 */
async function topUpAndCarryForwardPartialQueue(userId: string): Promise<boolean> {
  if (!isDailyTopUpCarryForwardEnabled()) return false;
  try {
    const prior = await getPriorInWindowDailyQueue(userId);
    if (!prior) return false;

    const unplayed = asQueueSlots(prior.slots).filter(
      (slot) => !slot.answered && !slot.skipped,
    );
    // Nothing left to preserve → let it regenerate a fresh Five (engaged user who
    // finished their set). Full untouched queues are carryForwardUntouchedDailyQueue's
    // job and never reach here (it returns first).
    if (unplayed.length === 0) return false;

    // Carry at most a full Five of unplayed slots; top up only the shortfall. A
    // partial queue with >= DAILY_QUEUE_SIZE unplayed (e.g. bonus slots) needs no
    // generation at all.
    const carried = unplayed.slice(0, DAILY_QUEUE_SIZE);
    const needed = DAILY_QUEUE_SIZE - carried.length;

    let fresh: GeneratedQuestionRow[] = [];
    if (needed > 0) {
      try {
        fresh = await generateDailyQuestionsFromKnowledgeBase(userId, overRequest(needed), {
          firstRun: false,
        });
      } catch (error) {
        console.warn('[daily/queue-orchestrator] top-up generation failed; falling back to fresh build', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    }

    const { merged, newGeneratedIds } = mergeCarriedWithFresh(carried, fresh);

    // Only commit a queue at or above the usable floor. If we couldn't reach it
    // (tiny carried set + a tapped-out KB that produced nothing), fall through to
    // the normal build so its graceful-degrade / generation_failed path decides.
    if (merged.length < DAILY_QUEUE_MIN_SIZE) return false;

    const built = await carryForwardQueueWithSlots(userId, prior.id, merged, newGeneratedIds);
    if (built) {
      console.info('[daily/queue-orchestrator] topped up carried-forward partial queue', {
        userId,
        carried: carried.length,
        added: newGeneratedIds.length,
        total: merged.length,
      });
    }
    return built;
  } catch (error) {
    console.warn('[daily/queue-orchestrator] top-up carry-forward failed; falling back to fresh build', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function fillDailyQueueForUser(
  userId: string,
  options?: { background?: boolean },
): Promise<void> {
  const inFlight = inFlightFills.get(userId);
  if (inFlight) return inFlight;

  // Background (cron) builds get the longer top-up budget their 300s route allows;
  // the synchronous POST / pre-warm keep the 90s budget for perceived latency.
  const durationBudgetMs = options?.background
    ? BACKGROUND_DURATION_BUDGET_MS
    : FUNCTION_DURATION_BUDGET_MS;

  // A0: every LLM call made anywhere inside this build inherits one correlation
  // id via AsyncLocalStorage, and the build records its OWN wall clock. Both
  // exist so build spans never have to be reconstructed by clustering
  // LlmUsageEvent rows on time again — an approach that produced three separate
  // measurement errors. Purely observational: nothing here changes what is
  // generated or served.
  const promise = runBuildWithMetrics(
    userId,
    () => buildDailyQueueForUser(userId, durationBudgetMs),
    (ctx) => finalizeDailyBuildMetric(ctx),
    (error) =>
      error instanceof DailyQueueFillError && error.code === 'no_knowledge_base'
        ? 'no_knowledge_base'
        : 'error',
  ).finally(() => {
    // Clear on settle (success OR failure) so the next genuine build for this
    // user isn't blocked by a stale entry — a rejected build must be retryable.
    inFlightFills.delete(userId);
  });
  inFlightFills.set(userId, promise);
  return promise;
}

async function buildDailyQueueForUser(
  userId: string,
  durationBudgetMs: number,
): Promise<void> {
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
    if (!(await clearStaleShortTodayQueue(userId))) {
      noteOutcome('existing_queue');
      return;
    }
  }

  // Before billing the LLM for a new set, roll a previous *unplayed* queue
  // forward to today. The cron builds a queue for every onboarded user daily
  // with no activity filter, so an absent user would otherwise accrue a fresh
  // generation every day for questions they never opened. Their last queue is
  // still sitting unplayed; re-dating it gives them the same five at zero cost.
  // A played prior queue is left alone, so engaged users still get a fresh set.
  if (await carryForwardUntouchedDailyQueue(userId)) {
    noteOutcome('carry_forward');
    return;
  }

  // Before billing a full fresh build, top-up-carry-forward a PARTIAL/SHORT prior
  // unplayed queue: keep the unplayed questions, generate only the shortfall to
  // refill to five. carryForwardUntouchedDailyQueue above only handles a fully
  // untouched set; this covers "they played some / got a short set yesterday but
  // still have unplayed questions — don't regenerate from scratch" (flag-gated).
  if (await topUpAndCarryForwardPartialQueue(userId)) {
    noteOutcome('partial_carry_forward');
    return;
  }

  const [knowledgeBase, preferences, excludedDomains] = await Promise.all([
    getKnowledgeBase(userId),
    getDailyPreferences(userId),
    getExcludedKnowledgeDomains(userId),
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
  // In BOTH modes, drop domains the player parked in "Resting" on the Game
  // settings page. "Resting" means "won't be asked for now" (see the territory
  // setup zones), and the LLM generator already honors it in both modes — but
  // the authored/house pickers only filter by this allow-set, so a rested
  // category could still leak into the Daily Five via a vetted friend or house
  // question. Custom mode normally has no rested entries in selectedDomains
  // (buildSavePayload excludes them), but the single-domain frequency endpoint
  // didn't always sync the list, so prod rows written through it carry rested
  // strays — filter here rather than trust the invariant. The starvation guard
  // keeps the unfiltered selection if EVERY selected domain is rested,
  // mirroring the generator's all-rested fallback.
  const restingDomains = new Set(
    Object.entries(preferences.domainPreferenceFrequency ?? {})
      .filter(([, frequency]) => frequency === 'resting')
      .map(([domain]) => domain.toLowerCase()),
  );
  const notResting = (domain: string) => !restingDomains.has(domain.toLowerCase());
  // D-DOMAIN-REST-01: also drop domains the player Rested (a domain-exclusion
  // with a live expiry) or permanently Muted from the game summary. Random mode
  // already excludes these via getKnowledgeBase, but custom mode is constrained
  // to the explicit selectedDomains list, which never sees exclusions — so a
  // Rested/Muted category would otherwise still leak into a custom-mode Daily
  // Five through the authored/house pickers (the exact gap the resting filter
  // above closes for the frequency tier). Rest/Mute write subcategory scope, so
  // match on the subcategory set; expired Rests are already gone from this set.
  const notExcluded = (domain: string) =>
    !excludedDomains.subcategories.has(domain.toLowerCase());
  const notRestingOrExcluded = (domain: string) => notResting(domain) && notExcluded(domain);
  const selectedActive = preferences.selectedDomains.filter(notRestingOrExcluded);
  const allowedSubcategories: ReadonlySet<string> = new Set(
    preferences.domainMode === 'custom'
      ? (selectedActive.length > 0 ? selectedActive : preferences.selectedDomains)
      : knowledgeBase.map((domain) => domain.domain).filter(notResting),
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

  // In concert with the Game settings page, the diversity cap is frequency-aware
  // at the low end only:
  //   • "blue_moon"→ capped at 1 per round. "See rarely" must mean a Blue Moon
  //                  domain can't take two of the five slots — and because THIS
  //                  shared gate also runs over friend-authored picks (unlike the
  //                  frequency *weighting*, which only steers generated domains),
  //                  this is the one lever that stops a friend's questions in a
  //                  Blue Moon domain from doubling up. Starvation is impossible:
  //                  a deflected 2nd pick goes to the reserve and is backfilled if
  //                  the queue would otherwise come up short.
  //   • "often"/"sometimes"/unset → the base cap (2, scaled up only for very
  //                  thin KBs). "often" used to be EXEMPT here (bounded only by
  //                  queue size) — Josh 2026-09-02, after a 4-of-5 "20th Century
  //                  Composers" Five: two is the max he wants to see for ANY
  //                  domain, including an explicit "often". "Often" still does
  //                  its job through the frequency *weighting* upstream (more
  //                  likely to be picked at all, and to reappear more days), it
  //                  just can no longer crowd out the rest of one day's Five.
  //   • "resting"  → already removed from allowedSubcategories upstream.
  // Keys are lowercased to match how restingDomains is built above and how the gate
  // normalizes each subcategory.
  const freqEntries = Object.entries(preferences.domainPreferenceFrequency ?? {});
  const blueMoonDomains = new Set(
    freqEntries.filter(([, frequency]) => frequency === 'blue_moon').map(([domain]) => domain.toLowerCase()),
  );
  const capForSubcategory = (normalizedSubcategory: string): number => {
    if (blueMoonDomains.has(normalizedSubcategory)) return 1;
    return baseDiversityCap;
  };
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

  // Per-pick deflection trail (B-DIVERSITY-BACKFILL-CAP-01 diagnostics,
  // 2026-08-30 follow-up). The aggregate deflectedFor* counters above answer
  // "how many", not "which domain, from which source, for which reason" — the
  // exact detail missing when a prod incident (5/5 "Beethoven") needed root-
  // causing after the fact and only the counts (not the per-row reasons) would
  // have been available. Logged once, right before the soft-cap backfill draws
  // on these reserves, so a future incident is diagnosable from THIS build's
  // logs instead of reconstructed from GeneratedQuestion timestamps days later.
  type ReserveDeflection = {
    source: 'authored' | 'house' | 'generated';
    subcategory: string;
    reason: 'answer_cooldown' | 'subject_cooldown' | 'diversity_cap';
  };
  const reserveDeflections: ReserveDeflection[] = [];

  // Permanently hidden questions ("Never show this question again", the durable
  // scope of the Not-for-me sheet).
  //
  // *** THIS IS AN ABSOLUTE DROP, NOT A DEFLECTION. ***
  // Every other gate in this builder (answer cooldown, subject cooldown,
  // diversity) pushes a rejected pick into a reserve so a tapped-out knowledge
  // base can restore it rather than serve a short queue. A hidden question must
  // never come back by ANY path — not the reserve, not the top-up rounds, not
  // the short-core backfill. The player said never. Serving a four-question
  // Daily Five is the correct outcome if the alternative is re-serving something
  // they explicitly hid.
  //
  // Fail-open on error: a lookup failure yields empty sets, so a transient DB
  // blip degrades to "hides not applied this build" rather than losing the build.
  const hiddenIds = await getHiddenQuestionIds(userId).catch(() => EMPTY_HIDDEN_IDS);
  const notHiddenCanonical = <T extends { id: string }>(pick: T): boolean =>
    !hiddenIds.questionIds.has(pick.id);

  const socialGraph = await getFriendAndFoFUserIds(userId);
  const authoredAll = (
    await pickEligibleAuthoredQuestions(userId, socialGraph, DAILY_QUEUE_SIZE, allowedSubcategories)
  ).filter(notHiddenCanonical);
  // Cap authored picks first (highest trust → first claim on each subcategory's
  // slots); deflected picks go to a reserve the backfill can draw on if the cap
  // would otherwise leave the queue short.
  // NOTE: only the diversity_cap branch below pushes into `authoredReserve` —
  // see the "reserves are diversity-only" comment above the backfill loop for
  // why answer_cooldown / subject_cooldown deflections must NEVER be backfill-
  // eligible.
  const authoredReserve: typeof authoredAll = [];
  const authored = authoredAll.filter((pick) => {
    if (answerCooldownGate.blocks(pick.answerText)) {
      deflectedForAnswerCooldown += 1;
      reserveDeflections.push({
        source: 'authored',
        subcategory: pick.canonicalSubcategory ?? '',
        reason: 'answer_cooldown',
      });
      return false;
    }
    if (subjectCooldownGate.blocks(pick.subjectEntity, pick.answerText)) {
      deflectedForSubjectCooldown += 1;
      reserveDeflections.push({
        source: 'authored',
        subcategory: pick.canonicalSubcategory ?? '',
        reason: 'subject_cooldown',
      });
      return false;
    }
    if (!diversityGate.admit(pick.canonicalSubcategory)) {
      authoredReserve.push(pick);
      reserveDeflections.push({
        source: 'authored',
        subcategory: pick.canonicalSubcategory ?? '',
        reason: 'diversity_cap',
      });
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
  // Hidden house picks are dropped outright, same absolute rule as authored above.
  const housePicksAll = (
    await pickHouseQuestions(userId, DAILY_QUEUE_SIZE - authored.length, allowedSubcategories)
  ).filter(notHiddenCanonical);
  const houseReserve: typeof housePicksAll = [];
  const housePicks = housePicksAll.filter((pick) => {
    if (answerCooldownGate.blocks(pick.answerText)) {
      deflectedForAnswerCooldown += 1;
      reserveDeflections.push({
        source: 'house',
        subcategory: pick.canonicalSubcategory ?? '',
        reason: 'answer_cooldown',
      });
      return false;
    }
    if (subjectCooldownGate.blocks(pick.subjectEntity, pick.answerText)) {
      deflectedForSubjectCooldown += 1;
      reserveDeflections.push({
        source: 'house',
        subcategory: pick.canonicalSubcategory ?? '',
        reason: 'subject_cooldown',
      });
      return false;
    }
    if (!diversityGate.admit(pick.canonicalSubcategory)) {
      houseReserve.push(pick);
      reserveDeflections.push({
        source: 'house',
        subcategory: pick.canonicalSubcategory ?? '',
        reason: 'diversity_cap',
      });
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
  // Picks dropped because the player permanently hid them (Not-for-me sheet).
  let droppedHidden = 0;
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
    // Permanently hidden generated question — absolute drop, no reserve (see the
    // hiddenIds comment above). A regenerated row reaching the same id the player
    // hid is still the question they refused.
    if (hiddenIds.generatedQuestionIds.has(question.id)) {
      droppedHidden += 1;
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
      reserveDeflections.push({
        source: 'generated',
        subcategory: question.canonicalSubcategory ?? '',
        reason: 'answer_cooldown',
      });
      continue;
    }
    if (subjectCooldownGate.blocks(question.subjectEntity, question.answer)) {
      deflectedForSubjectCooldown += 1;
      reserveDeflections.push({
        source: 'generated',
        subcategory: question.canonicalSubcategory ?? '',
        reason: 'subject_cooldown',
      });
      continue;
    }
    // Intra-day diversity cap, applied AFTER the generic + dedup gates so a deflected
    // pick is a genuine, distinct question we're merely spacing out — see the reserve
    // backfill below.
    if (!diversityGate.admit(question.canonicalSubcategory)) {
      deflectedForDiversity += 1;
      generatedReserve.push(question);
      reserveDeflections.push({
        source: 'generated',
        subcategory: question.canonicalSubcategory ?? '',
        reason: 'diversity_cap',
      });
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
  // A0 counterfactual: stamp the moment GATED slots first reach the playable
  // floor, measured against in-memory assembly rather than the write. Under
  // A0/A1 the write happens once at the end, so deriving this from the write
  // would make it identical to the final span by construction — the same
  // circularity as the withdrawn "bank builds take 0.0s" figure. This is the
  // only honest input to "what would write-at-3 have bought?".
  const stampFloorIfReached = () => {
    if (authored.length + housePicks.length + dedupedGenerated.length + topUpGenerated.length >=
        DAILY_QUEUE_MIN_SIZE) {
      noteGatedFloorReached();
    }
  };
  stampFloorIfReached();
  while (
    DAILY_QUEUE_SIZE -
      (authored.length + housePicks.length + dedupedGenerated.length + topUpGenerated.length) >
      0 &&
    topUpRounds < MAX_TOP_UP_ROUNDS &&
    hasBudgetForAnotherRound(Date.now() - startedAt, durationBudgetMs)
  ) {
    topUpRounds += 1;
    const roundStartedAt = Date.now();
    const roundShortfall =
      DAILY_QUEUE_SIZE -
      (authored.length + housePicks.length + dedupedGenerated.length + topUpGenerated.length);
    // Broaden the palette: skip the domains already filling the queue so this
    // round draws from the user's other selected domains (the exhausted-favorites
    // short-queue case). Falls back to the full palette inside the generator if
    // exclusion would empty it, so a single-domain user is unaffected.
    const filledDomains = isDailyTopUpBroadenEnabled()
      ? new Set<string>([
          ...authored.map((pick) => pick.canonicalSubcategory),
          ...housePicks.map((pick) => pick.canonicalSubcategory),
          ...dedupedGenerated.map((question) => question.canonicalSubcategory),
          ...topUpGenerated.map((question) => question.canonicalSubcategory),
        ])
      : undefined;
    const extra = await generateDailyQuestionsFromKnowledgeBase(
      userId,
      overRequest(roundShortfall),
      {
        firstRun: isFirstRun,
        underDifficultyReserve,
        ...(filledDomains && filledDomains.size > 0 ? { excludeDomains: filledDomains } : {}),
      },
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
        reserveDeflections.push({
          source: 'generated',
          subcategory: question.canonicalSubcategory ?? '',
          reason: 'answer_cooldown',
        });
        continue;
      }
      if (subjectCooldownGate.blocks(question.subjectEntity, question.answer)) {
        deflectedForSubjectCooldown += 1;
        generatedReserve.push(question);
        reserveDeflections.push({
          source: 'generated',
          subcategory: question.canonicalSubcategory ?? '',
          reason: 'subject_cooldown',
        });
        continue;
      }
      if (!diversityGate.admit(question.canonicalSubcategory)) {
        deflectedForDiversity += 1;
        generatedReserve.push(question);
        reserveDeflections.push({
          source: 'generated',
          subcategory: question.canonicalSubcategory ?? '',
          reason: 'diversity_cap',
        });
        continue;
      }
      answerCooldownGate.record(question.answer);
      subjectCooldownGate.record(question.subjectEntity, question.answer);
      topUpGenerated.push(question);
      recoveredThisRound += 1;
    }
    // A0: close this round's span and re-check the playable floor. Round count
    // is recorded alongside call count because the two disagree about what
    // drives wall clock — chunks run in PARALLEL (GENERATION_CHUNK_SIZE = 3)
    // while rounds are separated by a sequential gate chain, so a 9-call single
    // round can finish faster than 5 calls spread over three rounds. Recording
    // both lets that be regressed rather than argued.
    noteRound({
      round: topUpRounds,
      phase: 'core',
      generationMs: Date.now() - roundStartedAt,
      gateMs: 0,
      chunks: Math.ceil(overRequest(roundShortfall) / GENERATION_CHUNK_SIZE_HINT),
    });
    stampFloorIfReached();
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
  //
  // The reserves feeding this backfill hold ONLY diversity_cap-deflected picks —
  // answer_cooldown and subject_cooldown deflections are filtered out upstream
  // (never pushed into authoredReserve/houseReserve/generatedReserve) and are
  // absolute for this build, exactly like the hidden-question drop above. Prod
  // incident 2026-09-01: a "Beethoven's only opera" pick was answer-cooldown-
  // deflected (Josh had answered the identical fact 18 days earlier) but the
  // backfill loop used to re-admit ANY reserved pick it could find room for under
  // the diversity gate alone, without re-checking why the pick was reserved in the
  // first place — silently reintroducing the very repeat the cooldown exists to
  // prevent. Never let backfill re-admit a cooldown-deflected pick.
  //
  // The backfill draw is capped by the SAME per-subcategory limit as the primary
  // pass (B-DIVERSITY-BACKFILL-CAP-01 originally allowed one extra slot here —
  // capForSubcategory(key) + 1 — to avoid a single reserve monopolizing a
  // shortfall, e.g. prod's 5/5 "Beethoven" house incident on 2026-08-30. Per Josh
  // 2026-09-01: even the +1 relaxation (3 of the same subcategory in one Five) is
  // too many — two is the max he wants to see, full stop). The "often" exemption
  // that survived THAT fix is gone too now — Josh 2026-09-02, after a 4-of-5
  // "20th Century Composers" Five reached exactly this path (the reserve, not
  // the primary pass, is what let a 4th "often" pick through). Backfill now
  // shares capForSubcategory outright rather than wrapping it. A queue that
  // can't reach five under this hard cap stays short rather than repetitive;
  // DAILY_QUEUE_MIN_SIZE is the floor.
  const backfillGate = makeSubcategoryDiversityGate(capForSubcategory);
  for (const pick of authored) backfillGate.admit(pick.canonicalSubcategory);
  for (const pick of housePicks) backfillGate.admit(pick.canonicalSubcategory);
  for (const question of generatedForQueue) backfillGate.admit(question.canonicalSubcategory);

  const authoredBackfill: typeof authored = [];
  const houseBackfill: typeof housePicks = [];
  const generatedBackfill: typeof generatedForQueue = [];
  let backfillShortfall =
    DAILY_QUEUE_SIZE - (authored.length + housePicks.length + generatedForQueue.length);
  for (const pick of authoredReserve) {
    if (backfillShortfall <= 0) break;
    if (!backfillGate.admit(pick.canonicalSubcategory)) continue;
    authoredBackfill.push(pick);
    backfillShortfall -= 1;
  }
  for (const pick of houseReserve) {
    if (backfillShortfall <= 0) break;
    if (!backfillGate.admit(pick.canonicalSubcategory)) continue;
    houseBackfill.push(pick);
    backfillShortfall -= 1;
  }
  for (const question of generatedReserve) {
    if (backfillShortfall <= 0) break;
    if (!backfillGate.admit(question.canonicalSubcategory)) continue;
    generatedBackfill.push(question);
    backfillShortfall -= 1;
  }
  const diversityBackfilled =
    authoredBackfill.length + houseBackfill.length + generatedBackfill.length;

  // Log the full deflection trail whenever anything was held back this build —
  // not gated on the generation_failed floor below, since the incident this
  // exists to catch (5/5 "Beethoven") built a FULL, successful-looking queue.
  // `bySubcategoryAndReason` collapses the per-pick trail to counts so a build
  // with many picks in one domain doesn't produce a huge log line; `unusedBy*`
  // shows exactly what was sitting in each reserve, still eligible, that the
  // backfill never got to — the detail that was missing when this incident
  // needed root-causing after the fact.
  if (reserveDeflections.length > 0) {
    const bySubcategoryAndReason = new Map<string, number>();
    for (const d of reserveDeflections) {
      const key = `${d.source}:${d.subcategory || '(blank)'}:${d.reason}`;
      bySubcategoryAndReason.set(key, (bySubcategoryAndReason.get(key) ?? 0) + 1);
    }
    console.info('[daily/queue-orchestrator] deflection trail', {
      userId,
      deflections: Object.fromEntries(bySubcategoryAndReason),
      backfilled: {
        authored: authoredBackfill.length,
        house: houseBackfill.length,
        generated: generatedBackfill.length,
      },
      unusedInReserve: {
        authored: authoredReserve.length - authoredBackfill.length,
        house: houseReserve.length - houseBackfill.length,
        generated: generatedReserve.length - generatedBackfill.length,
      },
      // Filtered by id (not a simple slice) — the backfill loop above can SKIP a
      // reserve item that's already at its backfill cap and admit a later, still-
      // eligible one, so a backfilled pick is not necessarily a reserve prefix.
      unusedSubcategories: {
        authored: authoredReserve
          .filter((p) => !authoredBackfill.some((b) => b.id === p.id))
          .map((p) => p.canonicalSubcategory),
        house: houseReserve
          .filter((p) => !houseBackfill.some((b) => b.id === p.id))
          .map((p) => p.canonicalSubcategory),
        generated: generatedReserve
          .filter((q) => !generatedBackfill.some((b) => b.id === q.id))
          .map((q) => q.canonicalSubcategory),
      },
    });
  }

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
  let coreGenerated = [...generatedForQueue, ...generatedBackfill, ...underDifficultyBackfill];

  // Verify-gate (2026-07-06): in the viewer's THIN DECLARED domains, hold back
  // UNVERIFIED fresh generations — the niche-fiction fabrication case ("Ben Ripley
  // vomits" in "Spy School Books 1-6") the factual gate can't catch. Only rows that
  // earned >= machine_verified serve; the rest wait for the async web-search verify
  // pass. DEFAULT ON as of 2026-07-08, together with the verifier wiki/fandom
  // allowlist default (VERIFY_GATE_THIN_DECLARED_ENABLED=false reverts). Applied
  // BEFORE the achieved/floor check so a gate-induced shortfall degrades or
  // retries like any other.
  const declaredDomains = new Set(
    knowledgeBase.filter((entry) => entry.territoryType === 'declared').map((entry) => entry.domain),
  );
  coreGenerated = await verifyGateThinDeclared(coreGenerated, declaredDomains);

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
      droppedHidden,
      baseDiversityCap,
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
    // Starvation deadlock-breaker. A sub-floor build means the requested palette
    // couldn't field even the minimum — and when generation comes back empty
    // (no under-difficulty reserve fills), recalibrateDomainDifficultyToSupply
    // above had nothing to learn a ceiling from, so the served tier stays pinned
    // and every retry re-fails at the same unserveable tier (the specialist
    // deadlock). Step the requested domains down one tier so the client's
    // auto-retry / tomorrow's cron asks for something serveable. Best-effort —
    // never let it mask or replace the generation_failed the caller expects.
    try {
      await relaxDomainDifficultyOnStarvation(userId, [...allowedSubcategories]);
    } catch (error) {
      console.error('[daily orchestrator] starvation difficulty relax failed', error);
    }
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
      droppedHidden,
      baseDiversityCap,
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

  // Daily Five +2 (D-4 §B, the territory ∪ activity reframe) — AND the short-core
  // serving backstop (Layer 1, supply-exhaustion fix). Draw a ranked pool of
  // domains from the durable territory + recent activity of the people the viewer
  // follows (Both > territory-only > activity-only), generate a fresh accessible
  // question per domain, then split them two ways:
  //   1. CORE BACKFILL: if the core came up short of DAILY_QUEUE_SIZE (the viewer's
  //      OWN palette was tapped out — every top-up round + reserve above is already
  //      spent by here), promote the first `coreShortfall` friend questions into
  //      the five as PLAIN CORE slots (buildBotSlot, no presence attribution → they
  //      genuinely count toward the set per isBonusSlot). This is what stops a dry
  //      own-palette from serving a 3- or 4-question "Daily Five": a friend-world
  //      question fills the gap instead. Accessible tier is acceptable here — a
  //      served five beats a short one.
  //   2. +2 BONUS: any remaining friend domains (up to DAILY_BONUS_SLOT_MAX) append
  //      as additive presence-attributed bonus slots exactly as before ("from
  //      {Name}'s world"), never counted toward the five.
  // We therefore request coreShortfall + DAILY_BONUS_SLOT_MAX domains so the bonus
  // isn't cannibalized by the backfill. When the core is already full coreShortfall
  // is 0 and this is byte-for-byte the old +2 behavior. Friend-sourced only (never
  // pads with the viewer's own domains — enforced by the `ownDomains` subtraction
  // inside getFriendDomainsForBonus, NOT by anything here; don't re-assert it as an
  // invariant at this layer); resting domains are excluded from BOTH the core
  // backfill and the bonus, so "This is {Name}'s bag but not mine" holds. The
  // pool serves only fresh questions — never a friend's literal answered question
  // (those live behind the Lately milestone click-through, D-4 §A).
  //
  // Generated BEFORE the single persist so the whole queue (core + bonus) lands
  // atomically. Wrapped so a generation failure degrades to a core-only queue
  // (possibly still short) instead of losing the entire build.
  // Set when there is +2 bonus work to run AFTER the queue is readable.
  let deferredBonusPlan: { candidates: FriendDomainCandidate[] } | null = null;
  try {
    // At this point `slots` holds only core slots (bonus is appended below), so its
    // length IS the core count. A dry own-palette leaves this under DAILY_QUEUE_SIZE.
    const coreShortfall = Math.max(0, DAILY_QUEUE_SIZE - slots.length);
    const friendDomains = await getFriendDomainsForBonus(
      userId,
      coreShortfall + DAILY_BONUS_SLOT_MAX,
      restingDomains,
    );
    // Gate the friend-domain LLM call on the remaining function budget. When little
    // time is left (e.g. a slow core build near the ceiling) skipping it lets the
    // core queue still persist instead of risking a mid-generation kill that would
    // lose the whole build. The core backfill is best-effort for the same reason a
    // short queue is tolerated down to the floor: a served four beats a lost build.
    if (friendDomains.length > 0 && hasBudgetForAnotherRound(Date.now() - startedAt, durationBudgetMs)) {
      // DEFERRAL SPLIT. Two different jobs used to share one generation call:
      // filling a SHORT core (promotion) and appending the +2 (bonus). Only the
      // second is optional, so only the second is deferred.
      //
      //   * core-fill runs SYNCHRONOUSLY and before persist -- those questions
      //     are part of the five, and a queue must not be served without them.
      //   * bonus generation is handed to a continuation that runs AFTER the
      //     queue is readable. That is the ~15s the player stops waiting for.
      //
      // The domains are ordered by getFriendDomainsForBonus, so taking the
      // first `coreShortfall` for promotion is the selector's own preference,
      // not a positional guess.
      const coreDomains = friendDomains.slice(0, coreShortfall);
      const bonusDomains = friendDomains.slice(
        coreShortfall,
        coreShortfall + DAILY_BONUS_SLOT_MAX,
      );

      let generatedFriend: Awaited<ReturnType<typeof generateBonusQuestionsForDomains>> = [];
      if (coreDomains.length > 0) {
        const coreFillStartedAt = Date.now();
        generatedFriend = await generateBonusQuestionsForDomains(
          userId,
          coreDomains.map((candidate) => candidate.domain),
        );
        // Tagged 'core', not 'bonus': this cycle fills the five and stays on the
        // critical path. Phase describes the WORK, not the code path it shares.
        noteRound({
          round: 0,
          phase: 'core',
          generationMs: Date.now() - coreFillStartedAt,
          gateMs: 0,
          chunks: coreDomains.length,
        });
      }
      // Deferred candidates, minus any this build has to borrow back to fill
      // the five. See the borrow loop below.
      const remainingForBonus = [...bonusDomains];
      let promotedToCore = 0;
      for (const { question } of generatedFriend) {
        // Promotion only. Bonus slots no longer land here -- they are appended
        // by the deferred continuation, after persist. A generated question
        // beyond the five is dropped rather than appended as a bonus, because
        // appending it here would put the player back behind the work this
        // split exists to move.
        //
        // Dropping it costs nothing: generateDailyQuestions already persisted it
        // with usedInQueue=false, only slots that reach the persisted queue flip
        // that true, and pickBankSource draws the viewer's OWN never-served rows
        // as well as cross-user stock -- so the question banks and makes this
        // user's next build faster. That property depends on
        // BANK_INCLUDE_OWN_UNUSED, which defaults ON. Turning it off makes every
        // dropped question here pure waste: generated, gated, never served.
        if (slots.length >= DAILY_QUEUE_SIZE) break;
        slots.push(buildBotSlot(question, position));
        generatedQuestionIds.push(question.id);
        position += 1;
        promotedToCore += 1;
      }
      // BORROW-BACK. Pre-assigning domains to roles costs robustness the old
      // code had for free: it generated across ALL shortfall+2 domains and
      // promoted from the whole returned pool, so a domain that produced
      // nothing was covered by another. Slicing first means one miss in the
      // core slice leaves the queue SHORT -- a regression in the very
      // short-core backstop this block exists to be.
      //
      // So when the core slice under-delivers, borrow the bonus domains back,
      // one at a time, and generate them synchronously. The cost is paid ONLY
      // on a miss: the happy path never enters this loop, and a build that is
      // already short is one where protecting the five beats protecting
      // latency. Every borrowed domain leaves the deferred set, so it can never
      // be generated twice.
      while (
        slots.length < DAILY_QUEUE_SIZE &&
        remainingForBonus.length > 0 &&
        hasBudgetForAnotherRound(Date.now() - startedAt, durationBudgetMs)
      ) {
        const borrowed = remainingForBonus.shift();
        if (!borrowed) break;
        noteBorrowedDomain();
        const borrowStartedAt = Date.now();
        const recovered = await generateBonusQuestionsForDomains(userId, [borrowed.domain]);
        noteRound({
          round: 0,
          phase: 'core',
          generationMs: Date.now() - borrowStartedAt,
          gateMs: 0,
          chunks: 1,
        });
        for (const { question } of recovered) {
          if (slots.length >= DAILY_QUEUE_SIZE) break;
          slots.push(buildBotSlot(question, position));
          generatedQuestionIds.push(question.id);
          position += 1;
          promotedToCore += 1;
        }
      }

      noteDeferredDomainCount(remainingForBonus.length);
      if (remainingForBonus.length > 0) {
        deferredBonusPlan = { candidates: remainingForBonus };
      }

      if (promotedToCore > 0) {
        console.info('[daily/queue-orchestrator] backfilled short core from friend domains', {
          userId,
          coreShortfall,
          promotedToCore,
          // Bonus is appended by the deferred continuation now, so every slot
          // present at this point is core.
          coreAfter: slots.length,
          deferredBonusDomains: deferredBonusPlan?.candidates.length ?? 0,
        });
      }
    }
  } catch (error) {
    console.warn('[daily/queue-orchestrator] +2 bonus / core-backfill generation failed; serving core only', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // D-MISSED-RETURN-01 §2 R3 — the missed-question RETURN slot, appended last.
  //
  // Appended, never one of the core five: a friend's fresh question must never
  // lose its seat to a repeat. `buildReturnSlot` stamps `return_scope`, which is
  // what keeps it out of getCoreSlots — same marker-field convention as the +2.
  //
  // *** DELIBERATE COOLDOWN EXEMPTION — DO NOT "FIX" THIS (§8.1) ***
  // The answer-cooldown gate (ANSWER_COOLDOWN_DAYS = 28) and the serve-time
  // repeat gates exist to stop a question the player already answered from
  // reappearing. A returning question is INTENTIONALLY a repeat, so it is
  // selected here — outside the gated core-pick loop — and never consulted
  // against `answerCooldown`. This is narrow on purpose: it exempts only the one
  // designated return slot, and is NOT a relaxation of the general gate. The
  // slot's answer is likewise never `record()`ed into the gate, so a return can't
  // suppress a legitimate core pick that happens to share its answer.
  // The 28-day answer cooldown and the 7-day return cooldown are different axes
  // and WILL disagree; for the return slot, the return cooldown governs.
  try {
    if (isMissedReturnEnabled() && (await isMissedReturnEnabledForUser(userId))) {
      const candidates = await getEligibleReturnCandidates(userId);
      const selected = selectReturnCandidates(candidates);
      if (selected.length > 0) {
        const questionRows = await loadReturnQuestions(selected);
        // Keyed by kind AND id: canonical and generated ids are separate
        // namespaces and must never be looked up interchangeably.
        const byKey = new Map(questionRows.map((q) => [`${q.kind}:${q.id}`, q]));
        const authorNames = await resolveCreatorNames(
          questionRows.map((q) => q.creatorId).filter((id): id is string => Boolean(id)),
        );
        for (const candidate of selected) {
          const question = byKey.get(`${candidate.kind}:${candidate.questionId}`);
          if (!question) continue;
          slots.push(
            buildReturnSlot(
              {
                ...question,
                authorName: question.creatorId ? authorNames.get(question.creatorId) ?? null : null,
                difficultyEstimate: question.difficultyEstimate ?? null,
              },
              candidate,
              position,
            ),
          );
          // A returning GENERATED question still needs its id recorded on the
          // queue, exactly like any other bot slot, so the persist path and the
          // answer route resolve it the same way.
          if (candidate.kind === 'generated') generatedQuestionIds.push(candidate.questionId);
          position += 1;
          // Serve-time, not render-time (§8.5): the state is written as the slot
          // is built, so the cap and the 7-day floor hold even if the player
          // never opens the queue.
          await recordReturnServed(
            userId,
            { kind: candidate.kind, questionId: candidate.questionId },
            candidate.scope,
          );
        }
      }
    }
  } catch (error) {
    // Never let the return slot cost a build — degrade to a queue without one.
    console.warn('[daily/queue-orchestrator] missed-return slot selection failed; serving without it', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // A0: record the size actually persisted, for the build metric.
  noteFinalSize(slots.length);
  await persistDailyQueue(userId, slots, generatedQuestionIds);
  // A0 (§2): the queue is now readable. user_visible_ms stops here; span_ms
  // keeps running through the deferred bonus work below, and the difference
  // between them on a single row is what the deferral bought.
  noteQueuePersisted();

  // ── The deferral (B'). ────────────────────────────────────────────────────
  // The queue is readable; everything below is off the player's critical path.
  //
  // PHASE 1 of the metric is written HERE, not in the continuation, so the row
  // exists from the moment the player can start. A continuation is not
  // guaranteed to complete -- a serverless freeze after the response, a throw,
  // or a caller where after() never runs -- and writing only there would leave
  // NO row, which cannot be told apart from "the build never happened". A row
  // with span_ms NULL says exactly which.
  const buildCtx = currentBuildContext();
  const runBonusTail = async () => {
    if (deferredBonusPlan) {
      await appendDeferredBonusSlots(userId, deferredBonusPlan.candidates, slots.length);
    }
    if (buildCtx) await finalizeDailyBuildMetric(buildCtx);
  };

  // after() exists only inside a request scope. The cron and the synchronous
  // POST have one; a direct script invocation does not. Falling back to inline
  // keeps those callers correct -- they simply do not get the latency win, and
  // `deferred: false` on the row says so, which is what stops an inline build
  // being read as a deferral that bought nothing.
  let scheduled = false;
  if (deferredBonusPlan) {
    try {
      after(runBonusTail);
      scheduled = true;
    } catch {
      scheduled = false;
    }
  }
  noteDeferred(scheduled);
  // Phase 1 lands before the continuation can fire, so the row is present the
  // moment the queue is readable either way.
  if (scheduled) noteDeferredContinuation();
  if (buildCtx) await insertDailyBuildMetric(buildCtx);
  // Inline fallback: no request scope, so run the tail now. Correct, just not
  // faster -- and `deferred: false` on the row is what stops this being read as
  // a deferral that bought nothing.
  if (!scheduled) await runBonusTail();

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

/**
 * Append the +2 bonus slots AFTER the queue is readable (the deferral).
 *
 * Runs off the player's critical path, so its only job is to not make things
 * worse. Every failure mode is an explicit no-op: the player keeps a complete,
 * playable five and simply does not get the two optional extras.
 *
 * Appends through createDailyQueueItemFromPresence -- the same primitive the
 * skip replacement uses -- so it inherits that path's invariants: it re-reads
 * the persisted slots inside a transaction rather than trusting the in-memory
 * array this build assembled, which by now may be stale (a skip could have
 * appended a replacement while bonus generation was running).
 *
 * Generation stays SEQUENTIAL. Parallelising it is rejected for the reasons
 * already on record; deferral removes the wait without touching the loop.
 */
async function appendDeferredBonusSlots(
  userId: string,
  candidates: FriendDomainCandidate[],
  startPosition: number,
): Promise<void> {
  try {
    const presenceByDomain = new Map(
      candidates.map((candidate) => [candidate.domain.toLowerCase(), candidate]),
    );
    const bonusStartedAt = Date.now();
    const generated = await generateBonusQuestionsForDomains(
      userId,
      candidates.map((candidate) => candidate.domain),
    );
    // The phase-tagged span for the work that just moved off the critical path.
    // Recorded before the appends so it prices GENERATION, which is the ~15s.
    noteRound({
      round: 0,
      phase: 'bonus',
      generationMs: Date.now() - bonusStartedAt,
      gateMs: 0,
      chunks: candidates.length,
    });

    let position = startPosition;
    let appended = 0;
    for (const { domain, question } of generated) {
      if (appended >= DAILY_BONUS_SLOT_MAX) break;
      try {
        await createDailyQueueItemFromPresence(
          userId,
          question.id,
          toBonusPresence(presenceByDomain.get(domain.toLowerCase())),
          position,
        );
        position += 1;
        appended += 1;
      } catch (error) {
        // One bad append must not cost the others.
        console.warn('[daily/queue-orchestrator] deferred bonus append failed', {
          userId,
          domain,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (appended > 0) {
      console.info('[daily/queue-orchestrator] appended deferred bonus slots', {
        userId,
        appended,
        generationMs: Date.now() - bonusStartedAt,
      });
    }
  } catch (error) {
    // Explicit no-op: the five are already persisted and playable.
    console.warn('[daily/queue-orchestrator] deferred bonus generation failed; core queue stands', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
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
