/**
 * Daily counters for the generation-time gate chain (0120).
 *
 * Every gate in generateDailyQuestions fails OPEN by design, so a gate that is
 * silently disabled (timing out, erroring, truncating on every call) drops
 * nothing and nothing surfaces it. These counters exist to make that visible:
 * the weekly quality digest renders per-gate drop rates and failed-open run
 * counts from here. Writes are best-effort and self-contained — a telemetry
 * failure can never block generation. Callers fire-and-forget:
 * `void recordGateDrops([...])`.
 */
import { gte, sql } from 'drizzle-orm';

import { db, gateDropStat } from '@/server/db';

/** Gate names, in gate-chain order. Shared by the writer and the digest. */
export const GATE_NAMES = [
  'quality',
  'factual',
  'recent_history',
  'batch_dedup',
  'intra_batch_embedding',
  'answered_history_embedding',
  'answer_cooldown',
  'subject_cooldown',
  'answer_leak',
  // Measure-only until PARTIAL_ANSWER_LEAK_ENABLED / DOMAIN_DRIFT_DROP_ENABLED
  // are set: `dropped` counts what each rule WOULD remove, so the flags get
  // flipped on evidence. See findAnswerLeaks / findQualityFailures.
  'answer_leak_partial',
  'answer_shape',
  'domain_drift',
  'difficulty_floor',
  'thin_declared',
] as const;
export type GateName = (typeof GATE_NAMES)[number];

/** Gates whose implementation is an LLM call that fails open on error — a
 * sustained drop-rate of zero here is suspicious, not reassuring. */
export const FAIL_OPEN_LLM_GATES: ReadonlySet<GateName> = new Set([
  'quality',
  'factual',
  'recent_history',
  'batch_dedup',
]);

export type GateDropEntry = {
  gate: GateName;
  /** Questions the gate saw this run. */
  considered: number;
  /** Questions the gate dropped this run. */
  dropped: number;
  /** 1 when the gate errored/timed out and passed everything unchecked. */
  failedOpen?: number;
};

const utcDay = () => new Date().toISOString().slice(0, 10);

export async function recordGateDrops(entries: GateDropEntry[]): Promise<void> {
  const day = utcDay();
  const rows = entries
    .filter((e) => e.considered > 0 || (e.failedOpen ?? 0) > 0)
    .map((e) => ({
      day,
      gate: e.gate,
      considered: Math.max(0, Math.round(e.considered)),
      dropped: Math.max(0, Math.round(e.dropped)),
      failedOpen: Math.max(0, Math.round(e.failedOpen ?? 0)),
    }));
  if (rows.length === 0) return;
  try {
    await db
      .insert(gateDropStat)
      .values(rows)
      .onConflictDoUpdate({
        target: [gateDropStat.day, gateDropStat.gate],
        set: {
          considered: sql`${gateDropStat.considered} + excluded.considered`,
          dropped: sql`${gateDropStat.dropped} + excluded.dropped`,
          failedOpen: sql`${gateDropStat.failedOpen} + excluded.failed_open`,
          updatedAt: sql`now()`,
        },
      });
  } catch (error) {
    console.warn('[gate-drop-stats] recordGateDrops failed (telemetry only)', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Shorthand for a gate's catch block: one failed-open run, nothing counted. */
export function recordGateFailedOpen(gate: GateName): void {
  void recordGateDrops([{ gate, considered: 0, dropped: 0, failedOpen: 1 }]);
}

export type GateDropSummary = {
  gate: string;
  considered: number;
  dropped: number;
  failedOpen: number;
};

/** Per-gate totals over the trailing window, in gate-chain order. */
export async function readGateDropStats(windowDays: number): Promise<GateDropSummary[]> {
  const start = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      gate: gateDropStat.gate,
      considered: sql<number>`sum(${gateDropStat.considered})::int`,
      dropped: sql<number>`sum(${gateDropStat.dropped})::int`,
      failedOpen: sql<number>`sum(${gateDropStat.failedOpen})::int`,
    })
    .from(gateDropStat)
    .where(gte(gateDropStat.day, start))
    .groupBy(gateDropStat.gate);
  const order = new Map<string, number>(GATE_NAMES.map((g, i) => [g, i]));
  return rows.sort(
    (a, b) => (order.get(a.gate) ?? GATE_NAMES.length) - (order.get(b.gate) ?? GATE_NAMES.length),
  );
}
