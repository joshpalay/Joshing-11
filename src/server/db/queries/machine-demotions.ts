import { and, asc, eq, isNull, ne } from 'drizzle-orm';

import { db, generatedQuestions, questions, users } from '@/server/db';
import {
  notSuppressedByContentReport,
  resolveActiveIncorrectReportsForGenerated,
  resolveActiveIncorrectReportsForQuestion,
} from '@/server/db/queries/content-reports';
import { getLatestProposalsForQuestions, type SalvageProposalRow } from '@/server/db/queries/salvage-proposals';
import { type QuestionSource, resolveAuthorDisplay } from '@/lib/questions-types';

// B-CRAFTER-LIFECYCLE-01 Phase 1 — the MACHINE stream of the admin review queue.
// The batch verifier (batch-verify-questions) demotes a canonical Question by
// setting publicStatus='needs_review' (verify-question.ts, Decision A); until now
// those rows sat invisible — the /admin/reports queue read only ContentReport.
// This module lists them and gives the crafter the two human dispositions:
//   restore — "the verifier was wrong": back to circulation, verdict overridden
//             to 'ok' (stamped, so the sweep does NOT re-demote a human call),
//             trustTier='human_validated'.
//   edit    — "the verifier was right, I fixed it": content updated, row returns
//             to circulation, and verified_at/verdict/reason are CLEARED so the
//             next batch-verify sweep re-fact-checks the HUMAN's edit. Nothing
//             enters or re-enters circulation exempt from LLM verification —
//             restore (an explicit human override) is the single exception.
//   retire  — "the verifier was right, not worth fixing": publicStatus='rejected'.
//             Soft and reversible (the row keeps its content and can be restored
//             later); there is NO hard-delete path in this module by design.
// Generated-bank demotions (is_duplicate=true) are intentionally NOT surfaced
// here: they were never served, they expire on their own, and the crafter's
// lever for bank supply is the creation surface (Phase 2), not row rescue.

export type MachineDemotionReviewItem = {
  questionId: string;
  questionText: string;
  correctAnswer: string;
  explanation: string | null;
  // The verifier's short verdict reason (0100). Null ⇒ demoted before the reason
  // was persisted — the client renders "reason not captured".
  verificationReason: string | null;
  verifiedAt: Date | null;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
  // Provenance for the human-vs-house/LLM badge, same shape as BlockedReviewItem.
  source: QuestionSource | null;
  creatorId: string | null;
  authorName: string | null;
  authorIsHouse: boolean;
  // D-QUALITY-SALVAGE-01: a machine-proposed, pre-re-verified minimal fix awaiting
  // one-click approval. Present only when a 'ready' proposal exists for this row.
  proposal: SalvageProposalRow | null;
  // The machine looked and found NO safe minimal fix (answer/premise at fault, or
  // the proposed edit failed re-verification) — this card genuinely needs human
  // judgment. Null alongside a null proposal ⇒ the salvage sweep hasn't reached
  // this row yet. Mutually exclusive with `proposal`.
  triage: { reason: string | null } | null;
};

// Demoted canonical questions awaiting a human call, oldest demotion first
// (queue semantics — the longest-suppressed row has waited longest for review).
export async function getMachineDemotionsForReview(): Promise<MachineDemotionReviewItem[]> {
  const rows = await db
    .select({
      questionId: questions.id,
      questionText: questions.questionText,
      correctAnswer: questions.answerText,
      explanation: questions.factualExplanation,
      verificationReason: questions.verificationReason,
      verifiedAt: questions.verifiedAt,
      canonicalSubcategory: questions.canonicalSubcategory,
      broadCategory: questions.broadCategory,
      source: questions.source,
      creatorId: questions.creatorId,
      authorName: users.displayName,
    })
    .from(questions)
    .leftJoin(users, eq(questions.creatorId, users.id))
    .where(
      and(
        eq(questions.publicStatus, 'needs_review'),
        isNull(questions.deletedAt),
        // A hard-blocked question (upheld-inappropriate / safety vet) belongs to
        // the Blocked/actioned tab alone — never offer "restore" on a card that
        // couldn't actually restore it (visibility stays blocked).
        ne(questions.visibility, 'blocked'),
        // One question, one card: while a content report is open|upheld, the
        // PLAYER-stream card owns it (inappropriate reports pin first). The
        // demotion card reappears once the report is resolved.
        notSuppressedByContentReport(questions.id, 'question'),
      ),
    )
    .orderBy(asc(questions.verifiedAt));

  const proposals = await getLatestProposalsForQuestions(rows.map((r) => r.questionId));

  return rows.map((row) => {
    const latest = proposals.get(row.questionId) ?? null;
    return {
      questionId: row.questionId,
      questionText: row.questionText,
      correctAnswer: row.correctAnswer,
      explanation: row.explanation,
      verificationReason: row.verificationReason,
      verifiedAt: row.verifiedAt,
      canonicalSubcategory: row.canonicalSubcategory,
      broadCategory: row.broadCategory,
      source: row.source,
      creatorId: row.creatorId,
      proposal: latest?.status === 'ready' ? latest : null,
      triage: latest?.status === 'unsalvageable' ? { reason: latest.reverifyReason } : null,
      ...resolveAuthorDisplay(row.creatorId, row.source, row.authorName),
    };
  });
}

export type DemotionActionResult =
  | { ok: true; action: 'restored' | 'retired' | 'edited' }
  | { ok: false; reason: 'not_found' | 'not_demoted' };

// "The verifier was wrong." Back to circulation at the column default
// (publicStatus 'not_scored' — the pre-demote status is not persisted; precedent:
// reverseBlock restoring visibility to 'public'). The verdict is overridden to
// 'ok' with verified_at kept stamped so the sweep never re-litigates a human
// call, and trustTier records that a human validated it.
export async function restoreDemotedQuestion(questionId: string): Promise<DemotionActionResult> {
  const updated = await db
    .update(questions)
    .set({
      publicStatus: 'not_scored',
      verificationVerdict: 'ok',
      trustTier: 'human_validated',
      updatedAt: new Date(),
    })
    .where(and(eq(questions.id, questionId), eq(questions.publicStatus, 'needs_review')))
    .returning({ id: questions.id });

  if (updated.length === 0) return await missReason(questionId);
  return { ok: true, action: 'restored' };
}

// "The verifier was right; this one isn't worth fixing." Soft-park it at
// publicStatus='rejected' — out of the review queue and out of public scoring,
// content intact, reversible by a later restore/edit. Never a DELETE.
export async function retireDemotedQuestion(questionId: string): Promise<DemotionActionResult> {
  const updated = await db
    .update(questions)
    .set({ publicStatus: 'rejected', updatedAt: new Date() })
    .where(and(eq(questions.id, questionId), eq(questions.publicStatus, 'needs_review')))
    .returning({ id: questions.id });

  if (updated.length === 0) return await missReason(questionId);
  return { ok: true, action: 'retired' };
}

export type EditQuestionContentInput = {
  questionText?: string;
  answerText?: string;
  factualExplanation?: string | null;
};

// Rework the question (either stream — a machine demotion or a player-reported
// row). The edit changes the facts, so the verification stamp is CLEARED:
// verified_at=NULL puts the row back in the batch-verify sweep's dragnet and the
// machine re-checks the human's edit. If the row was demoted (needs_review) it
// returns to circulation now, consistent with the store's circulate-while-the-
// sweep-catches-up posture. trustTier='human_validated' — a human shaped this row.
export async function editQuestionContent(
  questionId: string,
  input: EditQuestionContentInput,
): Promise<DemotionActionResult> {
  const [existing] = await db
    .select({ publicStatus: questions.publicStatus })
    .from(questions)
    .where(and(eq(questions.id, questionId), isNull(questions.deletedAt)))
    .limit(1);
  if (!existing) return { ok: false, reason: 'not_found' };

  await db
    .update(questions)
    .set({
      ...(input.questionText !== undefined ? { questionText: input.questionText } : {}),
      ...(input.answerText !== undefined ? { answerText: input.answerText } : {}),
      ...(input.factualExplanation !== undefined
        ? { factualExplanation: input.factualExplanation }
        : {}),
      ...(existing.publicStatus === 'needs_review' ? { publicStatus: 'not_scored' as const } : {}),
      // Re-enter the LLM verification sweep: the content changed, so the old
      // stamp no longer vouches for it.
      verifiedAt: null,
      verificationVerdict: null,
      verificationReason: null,
      trustTier: 'human_validated',
      updatedAt: new Date(),
    })
    .where(eq(questions.id, questionId));

  return { ok: true, action: 'edited' };
}

export type ReviewTarget = { table: 'question' | 'generated'; id: string };

export type ApproveResult =
  | { ok: true; resolvedReports: number }
  | { ok: false; reason: 'not_found' };

// B-REVIEW-RERUN-01 — "pass it, OK to go back in circulation." Persists the
// admin's edited content AND stamps a passing, human-validated verification,
// returning the row to circulation immediately. This is legitimately verified,
// not the exempt 'restore' override: it's called AFTER rerunQuestion has fact-
// checked the reworked question (the route requires the reviewer to have seen a
// verdict). Works on BOTH stores. Any active incorrect reports on the target
// are resolved as admin_edited.
type ApprovedContent = { questionText: string; answerText: string; explanation?: string | null };

// Push approved content from a Question twin onto its served GeneratedQuestion
// (B-TWIN-DRIFT-01). Content-only: the stem/answer/explainer that serving reads
// live. The GeneratedQuestion's verification stamp is intentionally untouched —
// the batch-verify sweep re-fact-checks it on its own cadence.
async function mirrorContentToGenerated(generatedQuestionId: string, input: ApprovedContent): Promise<void> {
  await db
    .update(generatedQuestions)
    .set({
      questionText: input.questionText,
      answer: input.answerText,
      // explainer is non-null in the generated store; only overwrite when the
      // edit supplies one (matches the approve-generated branch's convention).
      ...(input.explanation ? { explainer: input.explanation } : {}),
    })
    .where(eq(generatedQuestions.id, generatedQuestionId));
}

// Inverse mirror: push approved content from a GeneratedQuestion onto every live
// Question twin linked to it, keeping the admin/grading copy in lockstep. Bumps
// updatedAt (the twin's own edit marker); leaves the verification stamp to the sweep.
async function mirrorContentToTwins(generatedQuestionId: string, input: ApprovedContent, now: Date): Promise<void> {
  await db
    .update(questions)
    .set({
      questionText: input.questionText,
      answerText: input.answerText,
      ...(input.explanation !== undefined ? { factualExplanation: input.explanation ?? null } : {}),
      updatedAt: now,
    })
    .where(and(eq(questions.generatedQuestionId, generatedQuestionId), isNull(questions.deletedAt)));
}

export async function approveEditedQuestion(
  target: ReviewTarget,
  input: { questionText: string; answerText: string; explanation?: string | null },
): Promise<ApproveResult> {
  const now = new Date();

  if (target.table === 'question') {
    const updated = await db
      .update(questions)
      .set({
        questionText: input.questionText,
        answerText: input.answerText,
        ...(input.explanation !== undefined ? { factualExplanation: input.explanation } : {}),
        // Back to circulation, verified by the re-run + a human's approval.
        publicStatus: 'not_scored',
        verificationVerdict: 'ok',
        verifiedAt: now,
        verificationReason: 'admin re-verified',
        trustTier: 'human_validated',
        updatedAt: now,
      })
      .where(and(eq(questions.id, target.id), isNull(questions.deletedAt)))
      .returning({ id: questions.id, generatedQuestionId: questions.generatedQuestionId });
    if (updated.length === 0) return { ok: false, reason: 'not_found' };
    // Mirror the edit onto the linked GeneratedQuestion twin. Daily/bonus/catch-up
    // serving reads the stem/answer/explainer LIVE from the GeneratedQuestion
    // (daily.ts:833), so an edit that stops at the Question row never reaches the
    // copy players are served (B-TWIN-DRIFT-01). Mirror content only — the twin's
    // own verification stamp is left to the batch-verify sweep.
    if (updated[0]?.generatedQuestionId) {
      await mirrorContentToGenerated(updated[0].generatedQuestionId, input);
    }
    const resolvedReports = await resolveActiveIncorrectReportsForQuestion(target.id, 'admin_edited');
    return { ok: true, resolvedReports };
  }

  const updated = await db
    .update(generatedQuestions)
    .set({
      questionText: input.questionText,
      answer: input.answerText,
      ...(input.explanation ? { explainer: input.explanation } : {}),
      // Un-suppress (is_duplicate is the generated store's suppress flag) and
      // stamp the passing verification.
      isDuplicate: false,
      verificationVerdict: 'ok',
      verifiedAt: now,
      verificationReason: 'admin re-verified',
    })
    .where(eq(generatedQuestions.id, target.id))
    .returning({ id: generatedQuestions.id });
  if (updated.length === 0) return { ok: false, reason: 'not_found' };
  // Mirror onto any live Question twins linked to this GeneratedQuestion, so the
  // admin surface + grading path stay in lockstep with the served copy (see the
  // twin-branch note above). Content only; each twin's stamp is the sweep's job.
  await mirrorContentToTwins(target.id, input, now);
  const resolvedReports = await resolveActiveIncorrectReportsForGenerated(target.id);
  return { ok: true, resolvedReports };
}

// Distinguish "no such question" from "someone already actioned it" for the
// route's 404-vs-409 mapping (mirrors upholdReport's already_resolved).
async function missReason(questionId: string): Promise<DemotionActionResult> {
  const [row] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);
  return { ok: false, reason: row ? 'not_demoted' : 'not_found' };
}
