import { desc, eq } from 'drizzle-orm';

import { crafterDraftDecisions, db } from '@/server/db';

// B-CRAFTER-DECISION-LEDGER-01 — reads/writes for the keep/kill teaching
// ledger. Recording is BEST-EFFORT everywhere: the ledger exists to teach the
// draft prompt, and a teaching-data fault must never block the human's actual
// keep/kill (same posture as the shadow-log in reconcile-authored-domain).

export type DraftDecisionFlag = { kind: string; note: string };

export type DraftDecisionInput = {
  deciderId: string;
  domain: string;
  tier: 'shallow' | 'deep';
  questionText: string;
  answer: string;
  decision: 'kept' | 'killed';
  /** The machine's doubts as shown on the card at decision time. */
  flags?: DraftDecisionFlag[];
  /** On a keep where the human corrected the machine's answer. */
  editedAnswer?: string | null;
  /** The Question a keep created (null for kills and blocked keeps). */
  questionId?: string | null;
};

export async function recordDraftDecision(input: DraftDecisionInput): Promise<void> {
  try {
    await db.insert(crafterDraftDecisions).values({
      deciderId: input.deciderId,
      domain: input.domain,
      tier: input.tier,
      questionText: input.questionText,
      answer: input.answer,
      decision: input.decision,
      flags: input.flags ?? [],
      editedAnswer: input.editedAnswer ?? null,
      questionId: input.questionId ?? null,
    });
  } catch (error) {
    console.warn('[crafter-decisions] record failed (non-fatal)', {
      domain: input.domain,
      decision: input.decision,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type DraftDecisionExemplar = {
  questionText: string;
  answer: string;
  /** Set when the keeper corrected the machine's answer — the correction IS the lesson. */
  editedAnswer: string | null;
};

export type RecentDraftDecisions = {
  kept: DraftDecisionExemplar[];
  killed: DraftDecisionExemplar[];
};

// ─── Gate calibration (flags vs verdicts) ────────────────────────────────────

export type GateCalibrationRow = {
  kind: string;
  /** Candidates that carried this flag when the human decided. */
  shown: number;
  /** ...and the human kept anyway (the gate over-doubted). */
  keptDespite: number;
  /** ...and the human killed (the gate agreed with the human). */
  killed: number;
};

export type GateCalibration = {
  totalKept: number;
  totalKilled: number;
  /** Kills where the machine saw nothing wrong — the gates' blind spots. */
  cleanKills: number;
  byKind: GateCalibrationRow[];
};

/**
 * Pure aggregation of ledger rows into the flags-vs-verdicts readout. A keep
 * DESPITE a flag and a kill WITHOUT one are both corrections of the machine's
 * judgment — this is the evidence base any future auto-keep must clear.
 * Exported for unit tests.
 */
export function aggregateGateCalibration(
  rows: ReadonlyArray<{ decision: 'kept' | 'killed'; flags: DraftDecisionFlag[] }>,
): GateCalibration {
  const byKind = new Map<string, GateCalibrationRow>();
  let totalKept = 0;
  let totalKilled = 0;
  let cleanKills = 0;
  for (const row of rows) {
    if (row.decision === 'kept') totalKept += 1;
    else {
      totalKilled += 1;
      if (row.flags.length === 0) cleanKills += 1;
    }
    // A card can carry several flags of the same kind — count each kind once
    // per verdict so a doubled note doesn't double the calibration weight.
    const kinds = new Set(row.flags.map((f) => f.kind));
    for (const kind of kinds) {
      const entry = byKind.get(kind) ?? { kind, shown: 0, keptDespite: 0, killed: 0 };
      entry.shown += 1;
      if (row.decision === 'kept') entry.keptDespite += 1;
      else entry.killed += 1;
      byKind.set(kind, entry);
    }
  }
  return {
    totalKept,
    totalKilled,
    cleanKills,
    byKind: [...byKind.values()].sort((a, b) => b.shown - a.shown),
  };
}

// Bounded window: calibration is about the gates' CURRENT hit rate, and the
// admin page shouldn't scan an unbounded ledger.
const CALIBRATION_WINDOW = 500;

export async function getGateCalibration(): Promise<GateCalibration> {
  const rows = await db
    .select({
      decision: crafterDraftDecisions.decision,
      flags: crafterDraftDecisions.flags,
    })
    .from(crafterDraftDecisions)
    .orderBy(desc(crafterDraftDecisions.createdAt))
    .limit(CALIBRATION_WINDOW);
  return aggregateGateCalibration(
    rows.map((r) => ({ decision: r.decision, flags: r.flags ?? [] })),
  );
}

/**
 * The most recent verdicts in a domain, split by decision, newest first —
 * the in-context teaching set for the draft prompt. Bounded per verdict so
 * the prompt stays focused on the human's current bar, not their history.
 */
export async function getRecentDraftDecisions(
  domain: string,
  limitPerVerdict = 8,
): Promise<RecentDraftDecisions> {
  const rows = await db
    .select({
      questionText: crafterDraftDecisions.questionText,
      answer: crafterDraftDecisions.answer,
      editedAnswer: crafterDraftDecisions.editedAnswer,
      decision: crafterDraftDecisions.decision,
    })
    .from(crafterDraftDecisions)
    .where(eq(crafterDraftDecisions.domain, domain))
    .orderBy(desc(crafterDraftDecisions.createdAt))
    .limit(limitPerVerdict * 4);

  const kept: DraftDecisionExemplar[] = [];
  const killed: DraftDecisionExemplar[] = [];
  for (const row of rows) {
    const bucket = row.decision === 'kept' ? kept : killed;
    if (bucket.length >= limitPerVerdict) continue;
    bucket.push({
      questionText: row.questionText,
      answer: row.answer,
      editedAnswer: row.editedAnswer,
    });
    if (kept.length >= limitPerVerdict && killed.length >= limitPerVerdict) break;
  }
  return { kept, killed };
}
