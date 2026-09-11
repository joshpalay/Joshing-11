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
import { and, eq, gte, sql } from 'drizzle-orm';

import { db, gateDropStat } from '@/server/db';
import { currentBuildId } from '@/server/daily/build-context';

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
  // Bank RE-SERVE path, not generation. Every gate above runs only on freshly
  // generated questions; pickBankSource cloned old stock into the queue
  // ungated, so a defect that entered the bank before a gate existed was
  // re-served forever (2026-09-06: a Joyce-under-Woolf row from 2026-05-09 and
  // a self-answering onion/tears row from 2026-08-21, both re-served that day).
  // `considered` counts bank candidates examined, `dropped` counts rejected.
  'bank_pick_quality',
  'difficulty_floor',
  'thin_declared',
] as const;
/**
 * Defect classes the quality gate can return, mirroring the numbered list in
 * QUALITY_GATE_SYSTEM_PROMPT (generate-questions.ts). The gate is instructed to
 * prefix every reason with one of these plus a colon ("OFF_DOMAIN: ..."), and
 * the caller already routes on that prefix — which is what makes a per-defect
 * tally possible with no schema change.
 *
 * Why this exists (R8, 2026-09-11): the `quality` counter alone says 31% of
 * candidates were dropped but not WHICH rule fired, so there was no way to tell
 * a prompt change that reduced generic questions from one that merely made the
 * gate quieter. See audits/2026-09-11-Fable-QUESTION-DRIFT-PIPELINE-01.md §3.3.
 */
export const QUALITY_DEFECTS = [
  'ANSWER_LEAKED',
  'OPINION_OR_VAGUE',
  'FALSE_PREMISE',
  'SELF_ANSWERING',
  'GENERIC_AT_TIER',
  'MULTI_PART',
  'MISLEADING_SETUP',
  'OFF_DOMAIN',
  'DEFINITION_SUPPLIED',
] as const;
export type QualityDefect = (typeof QUALITY_DEFECTS)[number];

/** Synthetic gate name for one quality-gate defect class. `gate` is a plain text
 *  column, so these need no migration; they sort after the real gates. */
export type QualityDefectGate = `quality:${QualityDefect}`;

export function qualityDefectGate(defect: QualityDefect): QualityDefectGate {
  return `quality:${defect}`;
}

export type GateName = (typeof GATE_NAMES)[number] | QualityDefectGate;

/** Gates whose implementation is an LLM call that fails open on error — a
 * sustained drop-rate of zero here is suspicious, not reassuring. Deliberately
 * excludes the per-defect counters: an individual defect legitimately sits at
 * zero for long stretches, so it must never raise the silently-disabled alarm. */
export const FAIL_OPEN_LLM_GATES: ReadonlySet<GateName> = new Set([
  'quality',
  'factual',
  'recent_history',
  'batch_dedup',
]);

/**
 * Read the defect name off a gate reason ("OFF_DOMAIN: question is about Joyce")
 * — null when the reason carries no recognised prefix (an older row, or a model
 * that ignored the format instruction).
 */
export function parseQualityDefect(reason: string): QualityDefect | null {
  const head = reason.split(':', 1)[0]?.trim().toUpperCase() ?? '';
  return (QUALITY_DEFECTS as readonly string[]).includes(head) ? (head as QualityDefect) : null;
}

/**
 * Tally a quality-gate `reasons` map into one entry per defect class. Emits an
 * entry for EVERY known defect, including the ones that did not fire, so a
 * defect stuck at zero reads as a measured zero rather than as missing data —
 * that distinction is the whole point of the counter. `considered` is the batch
 * size, so each defect row carries the same denominator as the parent `quality`
 * row and the rates are directly comparable.
 */
export function tallyQualityDefects(
  reasons: Record<number, string>,
  considered: number,
): GateDropEntry[] {
  const counts = new Map<QualityDefect, number>(QUALITY_DEFECTS.map((defect) => [defect, 0]));
  for (const reason of Object.values(reasons)) {
    const defect = parseQualityDefect(reason);
    if (defect) counts.set(defect, (counts.get(defect) ?? 0) + 1);
  }
  return [...counts].map(([defect, dropped]) => ({
    gate: qualityDefectGate(defect),
    considered,
    dropped,
  }));
}

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
  const scope = currentBuildId() ? 'daily_build' : 'non_player';
  const rows = entries
    .filter((e) => e.considered > 0 || (e.failedOpen ?? 0) > 0)
    .map((e) => ({
      day,
      gate: e.gate,
      scope,
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
        target: [gateDropStat.day, gateDropStat.gate, gateDropStat.scope],
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
    .where(and(gte(gateDropStat.day, start), eq(gateDropStat.scope, 'daily_build')))
    .groupBy(gateDropStat.gate);
  const order = new Map<string, number>(GATE_NAMES.map((g, i) => [g, i]));
  return rows.sort(
    (a, b) => (order.get(a.gate) ?? GATE_NAMES.length) - (order.get(b.gate) ?? GATE_NAMES.length),
  );
}
