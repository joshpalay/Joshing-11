import { and, desc, eq, inArray } from 'drizzle-orm';

import { db, questionSalvageProposals } from '@/server/db';

export type SalvageProposalRow = {
  questionId: string;
  kind: 'extra_fact_stem' | 'extra_fact_explainer' | 'unsalvageable';
  proposedStem: string | null;
  proposedExplanation: string | null;
  reverifyReason: string | null;
  // 'ready' = a pre-re-verified fix awaiting one-click approval; 'unsalvageable'
  // = the machine looked and found no safe minimal fix (needs human judgment).
  // Terminal statuses (applied/rejected) are never returned — the human already
  // decided those, so the card shows nothing.
  status: 'ready' | 'unsalvageable';
};

type InsertSalvageProposal = {
  questionId: string;
  targetTable: 'question' | 'generated';
  kind: 'extra_fact_stem' | 'extra_fact_explainer' | 'unsalvageable';
  proposedStem: string | null;
  proposedExplanation: string | null;
  reverifyOutcome: 'ok' | 'demoted' | 'unverifiable';
  reverifyReason: string | null;
  status: 'ready' | 'unsalvageable';
};

/**
 * Record a fresh proposal for a question, retiring any prior live ('ready') one
 * first so the partial-unique index holds (a re-run supersedes, not stacks).
 */
export async function upsertSalvageProposal(row: InsertSalvageProposal): Promise<void> {
  await db
    .update(questionSalvageProposals)
    .set({ status: 'rejected' })
    .where(
      and(
        eq(questionSalvageProposals.questionId, row.questionId),
        eq(questionSalvageProposals.status, 'ready'),
      ),
    );
  await db.insert(questionSalvageProposals).values(row);
}

/**
 * The latest live-or-triaged proposal per question id — for the review-queue
 * join. Includes 'unsalvageable' so the card can distinguish "machine looked,
 * no safe fix — this genuinely needs you" from "machine hasn't looked yet".
 */
export async function getLatestProposalsForQuestions(
  questionIds: string[],
): Promise<Map<string, SalvageProposalRow>> {
  if (questionIds.length === 0) return new Map();
  const rows = await db
    .select({
      questionId: questionSalvageProposals.questionId,
      kind: questionSalvageProposals.kind,
      proposedStem: questionSalvageProposals.proposedStem,
      proposedExplanation: questionSalvageProposals.proposedExplanation,
      reverifyReason: questionSalvageProposals.reverifyReason,
      status: questionSalvageProposals.status,
    })
    .from(questionSalvageProposals)
    .where(
      and(
        inArray(questionSalvageProposals.questionId, questionIds),
        inArray(questionSalvageProposals.status, ['ready', 'unsalvageable']),
      ),
    )
    .orderBy(desc(questionSalvageProposals.createdAt));
  const out = new Map<string, SalvageProposalRow>();
  for (const r of rows) {
    if (!out.has(r.questionId)) {
      out.set(r.questionId, r as SalvageProposalRow);
    }
  }
  return out;
}

/**
 * Which of these question ids already have ANY proposal (ready/applied/rejected/
 * unsalvageable) — the batch skips them so it never re-spends on a question it
 * has already judged. (Re-processing a rejected one is a future --force concern.)
 */
export async function questionIdsWithProposal(questionIds: string[]): Promise<Set<string>> {
  if (questionIds.length === 0) return new Set();
  const rows = await db
    .select({ questionId: questionSalvageProposals.questionId })
    .from(questionSalvageProposals)
    .where(inArray(questionSalvageProposals.questionId, questionIds));
  return new Set(rows.map((r) => r.questionId));
}

/** Terminal-state a question's live proposal once the human acts on it. */
export async function resolveSalvageProposal(
  questionId: string,
  status: 'applied' | 'rejected',
): Promise<void> {
  await db
    .update(questionSalvageProposals)
    .set({ status })
    .where(
      and(
        eq(questionSalvageProposals.questionId, questionId),
        eq(questionSalvageProposals.status, 'ready'),
      ),
    );
}
