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
