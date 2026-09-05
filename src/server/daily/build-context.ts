import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Build correlation context for a single Daily Five build (A0).
 *
 * WHY THIS EXISTS. Before this, the only way to tell which LLM calls belonged
 * to which queue build was to cluster `LlmUsageEvent` rows by timestamp. That
 * produced three separate measurement errors in a row, each invisible from the
 * output:
 *   1. a one-day batch sweep (4,697 `self-containment` calls on 2026-07-12)
 *      was mistaken for daily-build traffic;
 *   2. 600s lookback windows OVERLAPPED for the 36% of queues the cron builds
 *      back-to-back, double-counting their calls;
 *   3. "bank-only builds take 0.0s" was circular — a build with no LLM calls
 *      has no LLM events, so its reconstructed span is zero by construction.
 * A correlation ID threaded through the real call graph removes the need to
 * infer any of it.
 *
 * WHY AsyncLocalStorage. The build call graph is deep (orchestrator →
 * generate-questions → per-domain gates) and the LLM wrapper
 * (`loggedMessagesCreate` in src/lib/llm.ts) is shared with unrelated callers.
 * Threading a buildId parameter through every signature would touch dozens of
 * functions and still miss anything called indirectly. ALS scopes the id to the
 * async execution of one build with no signature changes, and reads as
 * `undefined` for every non-build caller — so unrelated scopes keep writing a
 * NULL build_id exactly as before.
 *
 * PURE BOOKKEEPING. Nothing here changes what gets generated or served. The
 * counters are incremented from the build path and read once at the end.
 */

export type BuildRoundSpan = {
  round: number;
  /**
   * Which phase of the build this cycle belongs to. Set AT THE CALL SITE, never
   * derived from ordering or index arithmetic -- ordering is what `slot_index
   * < 5` tried to be, and it broke on exactly the queues it most needed to get
   * right.
   *
   * Without this tag, core rounds and bonus cycles land in one undifferentiated
   * series and reproduce the contamination that made the earlier round analyses
   * unusable. With it, the decomposition that took several exchanges of
   * statistical argument to infer becomes a GROUP BY.
   */
  phase: BuildPhase;
  /** Wall clock inside generation (parallel chunks) for this round. */
  generationMs: number;
  /** Wall clock inside the sequential gate chain for this round. */
  gateMs: number;
  /** Chunks the round actually dispatched (GENERATION_CHUNK_SIZE-bounded). */
  chunks: number;
};

/**
 * 'core'  -- a top-up round filling the five. On the critical path, always.
 * 'bonus' -- the +2 friend-bonus cycle. TODAY this also runs on the critical
 *            path, before persistDailyQueue; deferring it is the point of the
 *            exercise, and this tag is what lets the two be told apart in the
 *            data before and after.
 */
export type BuildPhase = 'core' | 'bonus';

export type BankAttempt = {
  domain: string;
  outcome: 'hit' | 'miss';
  /** Why a nominally covered domain failed to serve. Null on a hit. */
  missReason: 'tier' | 'fact_history' | 'no_stock' | null;
  tierRequested: string;
  tierServed: string | null;
};

export type DailyBuildContext = {
  buildId: string;
  userId: string;
  startedAt: number;
  /** Rounds actually entered. The §2 hypothesis is that span tracks THIS, not call count. */
  roundCount: number;
  generateCallCount: number;
  rounds: BuildRoundSpan[];
  bankAttempts: BankAttempt[];
  /**
   * Counterfactual for A2 (§3). Stamped from the IN-MEMORY assembly the moment
   * gated slots first reach DAILY_QUEUE_MIN_SIZE — deliberately NOT from the
   * write, which under A0/A1 happens once at the end and would make the metric
   * tautological ("first playable == final" by construction). This is the only
   * honest input to "what would write-at-3 have bought?".
   */
  gatedFloorReachedMs: number | null;
  /**
   * Time from build start to the queue being PERSISTED AND READABLE -- the
   * latency a player actually waits through.
   *
   * WHY THIS IS SEPARATE FROM spanMs. After the bonus deferral, the build still
   * does the bonus work; it just does it off the critical path. A span measured
   * from start to bonus completion would therefore read the SAME ~21s it reads
   * today, and the ~15s win would be invisible in the very instrument built to
   * see it. Pre-deferral these two fields are identical; post-deferral they
   * diverge by exactly the prize.
   *
   * That makes the deferral's effect a subtraction between two fields on ONE
   * row, rather than a before/after comparison across a deploy -- which at ~2
   * queues a day would be confounded by model latency, bank hit rate and domain
   * mix, and would need volume this system does not have.
   *
   * Null when the build never reached persistence (threw, or early-returned).
   */
  userVisibleMs: number | null;
  /**
   * Did the bonus work run OFF the player's critical path for this build?
   *
   * Null until decided. Set true when the continuation is scheduled, false when
   * we fall back to running inline because no request scope was available
   * (after() only exists inside a request). Both cases persist a row, and
   * without this flag an inline row is indistinguishable from a pre-deferral
   * row AND from a deferral that silently failed.
   */
  deferred: boolean | null;
  /** Bonus domains borrowed back to protect the five (cost lands in user_visible_ms). */
  borrowedDomainCount: number;
  /** Domains handed to the deferred continuation. 0 means there was nothing to defer. */
  deferredDomainCount: number;
  /**
   * True once the build has handed its remaining work (deferred bonus, then the
   * phase-2 metric write) to a scheduled continuation.
   *
   * runBuildWithMetrics checks this before recording: if a continuation owns the
   * tail, the finally block must NOT write the metric, because it runs the
   * moment the build returns -- which is BEFORE the deferred work finishes. That
   * would set span_ms at persist time, making it equal user_visible_ms on every
   * row and reporting a deferral that bought exactly zero. The continuation
   * finalizes instead.
   */
  deferredContinuationScheduled: boolean;
  aborted: boolean;
  /** Slot count actually persisted. 0 when the build threw before assembly. */
  finalSize: number;
  /**
   * What this invocation actually DID. Critical for analysis: buildDailyQueue-
   * ForUser early-returns on an existing queue, a carry-forward, and a partial
   * carry-forward. Those are not builds, and recording them as `built` with
   * zero generation calls would make them indistinguishable from genuine
   * bank-only builds -- the same contamination that made the withdrawn "bank
   * builds take 0.0s" figure wrong. Analysis must filter on outcome='built'.
   */
  outcome: BuildOutcome;
};

export type BuildOutcome =
  | 'built'
  | 'existing_queue'
  | 'carry_forward'
  | 'partial_carry_forward'
  | 'no_knowledge_base'
  | 'error';

const storage = new AsyncLocalStorage<DailyBuildContext>();

/** Runs `fn` inside a fresh build context. Returns the context for recording. */
export function runInBuildContext<T>(
  userId: string,
  fn: (ctx: DailyBuildContext) => Promise<T>,
): Promise<T> {
  const ctx: DailyBuildContext = {
    buildId: randomUUID(),
    userId,
    startedAt: Date.now(),
    roundCount: 0,
    generateCallCount: 0,
    rounds: [],
    bankAttempts: [],
    gatedFloorReachedMs: null,
    userVisibleMs: null,
    deferred: null,
    borrowedDomainCount: 0,
    deferredDomainCount: 0,
    deferredContinuationScheduled: false,
    aborted: false,
    finalSize: 0,
    outcome: 'built',
  };
  return storage.run(ctx, () => fn(ctx));
}

/** The active build context, or undefined outside a build. */
export function currentBuildContext(): DailyBuildContext | undefined {
  return storage.getStore();
}

/** The active build id, or null — what `recordLlmUsage` stamps onto each event. */
export function currentBuildId(): string | null {
  return storage.getStore()?.buildId ?? null;
}

// ── Counters. All no-op outside a build context, so callers never branch. ──

export function noteGenerateCall(): void {
  const ctx = storage.getStore();
  if (ctx) ctx.generateCallCount += 1;
}

export function noteRound(span: BuildRoundSpan): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.roundCount += 1;
  ctx.rounds.push(span);
}

export function noteBankAttempt(attempt: BankAttempt): void {
  const ctx = storage.getStore();
  if (ctx) ctx.bankAttempts.push(attempt);
}

/**
 * Stamp the floor-reached moment. First call wins — later assembly growth must
 * not move it, or the metric stops meaning "when could we first have served".
 */
export function noteGatedFloorReached(): void {
  const ctx = storage.getStore();
  if (ctx && ctx.gatedFloorReachedMs === null) {
    ctx.gatedFloorReachedMs = Date.now() - ctx.startedAt;
  }
}

/**
 * Stamp the moment the queue became readable by the player. Called immediately
 * after persistDailyQueue resolves. First call wins: a later append (the
 * deferred bonus write) must not move it, or the field stops meaning "when
 * could the player start".
 */
export function noteQueuePersisted(): void {
  const ctx = storage.getStore();
  if (ctx && ctx.userVisibleMs === null) {
    ctx.userVisibleMs = Date.now() - ctx.startedAt;
  }
}

/**
 * Hand the tail of the build to a scheduled continuation. After this, the
 * continuation owns the phase-2 metric write.
 */
export function noteDeferredContinuation(): void {
  const ctx = storage.getStore();
  if (ctx) ctx.deferredContinuationScheduled = true;
}

/** One bonus domain was borrowed back to fill a short core. */
export function noteBorrowedDomain(): void {
  const ctx = storage.getStore();
  if (ctx) ctx.borrowedDomainCount += 1;
}

/** How many domains the deferred continuation was handed. */
export function noteDeferredDomainCount(count: number): void {
  const ctx = storage.getStore();
  if (ctx) ctx.deferredDomainCount = count;
}

/** Record whether the bonus work was deferred or run inline. */
export function noteDeferred(deferred: boolean): void {
  const ctx = storage.getStore();
  if (ctx) ctx.deferred = deferred;
}

export function noteFinalSize(size: number): void {
  const ctx = storage.getStore();
  if (ctx) ctx.finalSize = size;
}

export function noteOutcome(outcome: BuildOutcome): void {
  const ctx = storage.getStore();
  if (ctx) ctx.outcome = outcome;
}

export function noteAborted(): void {
  const ctx = storage.getStore();
  if (ctx) ctx.aborted = true;
}


/**
 * Run one build inside a fresh context and record its metric on EVERY exit
 * path, including a throw.
 *
 * Extracted from the orchestrator specifically so the failure path is unit
 * testable. If the metric were written only on success, aborted and thrown
 * builds would emit no row and the tail -- the entire population Track A
 * targets -- would be invisible in the data.
 */
export async function runBuildWithMetrics<T>(
  userId: string,
  build: () => Promise<T>,
  record: (ctx: DailyBuildContext) => Promise<void>,
  classifyError: (error: unknown) => BuildOutcome = () => 'error',
): Promise<T> {
  return runInBuildContext(userId, async (ctx) => {
    try {
      return await build();
    } catch (error) {
      ctx.outcome = classifyError(error);
      throw error;
    } finally {
      // Best-effort: telemetry must never convert a successful build into a
      // failure, nor mask a real build error on its way out.
      //
      // Skipped when a continuation owns the tail: this block runs the moment
      // the build RETURNS, which under the bonus deferral is before the deferred
      // work has finished. Recording here would stamp span_ms at persist time,
      // make it equal user_visible_ms on every row, and report that deferring
      // bought nothing. The continuation calls finalize instead.
      if (!ctx.deferredContinuationScheduled) await record(ctx).catch(() => {});
    }
  });
}
