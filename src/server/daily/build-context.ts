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
  /** Wall clock inside generation (parallel chunks) for this round. */
  generationMs: number;
  /** Wall clock inside the sequential gate chain for this round. */
  gateMs: number;
  /** Chunks the round actually dispatched (GENERATION_CHUNK_SIZE-bounded). */
  chunks: number;
};

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
      await record(ctx).catch(() => {});
    }
  });
}
