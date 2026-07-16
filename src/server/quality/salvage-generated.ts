/**
 * Salvage-aware demotion for the GENERATED bank (2026-07-15, Josh).
 *
 * The batch-verify sweep hard-suppresses a demoted row (is_duplicate=true). For
 * AUTHORED questions that is chased by the salvage sweep, which proposes a fix a
 * human approves in /admin/reports. But generated-bank demotions are deliberately
 * NOT surfaced in that queue (machine-demotions.ts) — so a demoted generated row
 * goes dark with no salvage and no human review. A read-only dry run over the
 * uncovered fat-domain backlog showed a meaningful slice of demotions are the
 * salvageable class (answer correct, one wrong adjacent fact in the explainer —
 * e.g. Blanton's, Spy Ski School), which would be lost outright.
 *
 * Because a generated row is MACHINE-authored (no human's words to preserve — the
 * reason the salvage sweep is propose-only for Question rows), we can auto-apply a
 * re-verified minimal fix instead of parking a proposal nobody will approve. The
 * fix is gated exactly like the sweep's: the PROPOSED text must itself re-verify
 * `ok` before it is applied, so a bad "fix" can never reach circulation. A row
 * that can't be salvaged (unsalvageable, or the fix still fails re-verify) is
 * suppressed exactly as before — nothing that was demoted stays served un-fixed.
 *
 * Fail-safe: any proposer/verifier fault resolves to SUPPRESS (the pre-existing
 * behavior), never to a silent serve-through. Flag-guarded, DEFAULT ON, matching
 * the sibling SALVAGE_ON_DEMOTE_ENABLED posture; set
 * SALVAGE_GENERATED_ON_DEMOTE_ENABLED=false to revert to hard-suppress without a
 * deploy.
 */
import { eq } from 'drizzle-orm';

import { db, generatedQuestions } from '@/server/db';
import { proposeSalvage, type SalvageProposal } from '@/server/quality/salvage-question';
import { verdictToGeneratedPatch, verifyQuestion } from '@/server/quality/verify-question';

export function isSalvageGeneratedOnDemoteEnabled(): boolean {
  const raw = process.env.SALVAGE_GENERATED_ON_DEMOTE_ENABLED?.trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
}

export type GeneratedDemoteRow = {
  id: string;
  questionText: string;
  answer: string;
  explanation: string | null;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
};

export type GeneratedSalvageAction = 'salvaged' | 'suppressed';
export type GeneratedSalvageResult = { action: GeneratedSalvageAction; note: string };

/**
 * Pure decision: given the proposer's output and the re-verify outcome of the
 * PROPOSED text, apply the fix or suppress. Exported for unit tests. Apply ONLY
 * when a concrete edit exists AND it re-verified `ok`; everything else suppresses.
 */
export function decideGeneratedSalvage(
  proposal: SalvageProposal,
  reverifyOutcome: 'ok' | 'demoted' | 'unverifiable' | null,
): { apply: false } | { apply: true; proposedStem: string | null; proposedExplanation: string | null } {
  if (proposal.kind === 'unsalvageable') return { apply: false };
  if (!proposal.proposedStem && !proposal.proposedExplanation) return { apply: false };
  if (reverifyOutcome !== 'ok') return { apply: false };
  return {
    apply: true,
    proposedStem: proposal.proposedStem,
    proposedExplanation: proposal.proposedExplanation,
  };
}

/**
 * Salvage-or-suppress one demoted generated row. `persist=false` runs the full
 * propose→re-verify pipeline and reports the action WITHOUT writing (dry-run).
 * When persisting: a salvaged row is edited in place, stamped verified `ok`, and
 * LEFT SERVING (is_duplicate stays false); a suppressed row gets the standard
 * demote patch (is_duplicate=true, verdict='demoted').
 */
export async function salvageOrSuppressGeneratedDemote(
  row: GeneratedDemoteRow,
  verifierReason: string,
  now: Date,
  opts: { persist: boolean } = { persist: true },
): Promise<GeneratedSalvageResult> {
  const suppress = async (note: string): Promise<GeneratedSalvageResult> => {
    if (opts.persist) {
      await db
        .update(generatedQuestions)
        .set(verdictToGeneratedPatch('demoted', now, verifierReason))
        .where(eq(generatedQuestions.id, row.id));
    }
    return { action: 'suppressed', note };
  };

  const proposal = await proposeSalvage({
    questionText: row.questionText,
    answer: row.answer,
    explanation: row.explanation,
    verificationReason: verifierReason,
    canonicalSubcategory: row.canonicalSubcategory,
    broadCategory: row.broadCategory,
  });

  if (proposal.kind === 'unsalvageable') return suppress(`unsalvageable: ${proposal.note}`);

  // Re-verify the PROPOSED version against the UNCHANGED answer, same dimensions
  // the salvage sweep uses. Fall back to the original for the field left untouched.
  const reverify = await verifyQuestion({
    questionText: proposal.proposedStem ?? row.questionText,
    answer: row.answer,
    explanation: proposal.proposedExplanation ?? row.explanation ?? undefined,
    canonicalSubcategory: row.canonicalSubcategory ?? undefined,
    broadCategory: row.broadCategory ?? undefined,
    dimensions: ['false_premise', 'extra_fact'],
  });

  const decision = decideGeneratedSalvage(proposal, reverify?.outcome ?? null);
  if (!decision.apply) {
    return suppress(`reverify=${reverify?.outcome ?? 'none'}: ${proposal.note}`);
  }

  if (opts.persist) {
    await db
      .update(generatedQuestions)
      .set({
        ...(decision.proposedStem ? { questionText: decision.proposedStem } : {}),
        ...(decision.proposedExplanation ? { explainer: decision.proposedExplanation } : {}),
        // The proposed text passed the verifier — stamp it clean and keep it
        // serving. Answer is never touched by salvage.
        verificationVerdict: 'ok',
        verifiedAt: now,
        verificationReason: `salvaged: ${proposal.note}`.slice(0, 500),
      })
      .where(eq(generatedQuestions.id, row.id));
  }
  return { action: 'salvaged', note: `${proposal.kind}: ${proposal.note}` };
}
