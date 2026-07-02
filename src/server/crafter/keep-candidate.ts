/**
 * B-CRAFTER-LIFECYCLE-01 — the shared "keep" rail. One code path for BOTH the
 * crafter surface (Phase 2) and the invited player surface (Phase 3), so a kept
 * candidate always enters the same way:
 *   1. inline Haiku vet decides publicStatus (safety-fail → hard-blocked),
 *   2. createQuestion inserts with creatorId=the keeper, source='authored',
 *      trustTier='unverified', verifiedAt=NULL — the batch-verify sweep
 *      fact-checks EVERY kept question before it's vouched for (2026-07-01
 *      decision: nothing added skips LLM verification),
 *   3. provenance honest by construction: llmSuggestedAnswer carries the
 *      machine's original draft; an unchanged answer keeps 'llm_suggested',
 *      an edited one becomes 'llm_edited'.
 * The authorship-exclusion invariant then keeps the keeper from ever being
 * served their own question.
 */

import { createQuestion } from '@/server/db/queries/questions';
import { vetQuestion } from '@/server/llm/vet-question';
import { verdictToBlockedVisibility, verdictToPublicStatus } from '@/server/llm/vet-verdict';
import {
  broadCategoryDisplayName,
  normalizeBroadQuestionCategoryOrDefault,
} from '@/lib/question-categorization';

export type KeepCandidateInput = {
  keeperUserId: string;
  domain: string;
  questionText: string;
  answer: string;
  explainer?: string | null;
  machineDraftAnswer?: string | null;
  difficultyEstimate: 'accessible' | 'moderate' | 'specialist';
  broadCategory: string;
};

export type KeepCandidateResult =
  | { ok: true; id: string; publicStatus: string; vetReason: string }
  | { ok: false; reason: 'failed_content_check'; id: string };

const DIFFICULTY_TO_NUMBER: Record<'accessible' | 'moderate' | 'specialist', number> = {
  accessible: 1,
  moderate: 3,
  specialist: 5,
};

export async function keepCandidate(input: KeepCandidateInput): Promise<KeepCandidateResult> {
  const category = normalizeBroadQuestionCategoryOrDefault(input.broadCategory);
  const explanation = input.explainer?.trim() || null;

  const verdict = await vetQuestion({
    questionText: input.questionText,
    answer: input.answer,
    alternateAnswers: [],
    explanation,
    broadCategory: input.broadCategory,
    canonicalSubcategory: input.domain,
  });
  const publicScoring = verdictToPublicStatus(verdict);
  const blockedVisibility = verdictToBlockedVisibility(verdict);

  const created = await createQuestion({
    authorId: input.keeperUserId,
    text: input.questionText,
    correctAnswer: input.answer,
    alternateAnswers: [],
    explanation,
    category,
    broadCategory: broadCategoryDisplayName(category),
    subcategory: input.domain,
    canonicalSubcategory: input.domain,
    domain: input.domain,
    difficulty: DIFFICULTY_TO_NUMBER[input.difficultyEstimate],
    // verified reflects whether the kept answer is still the machine's
    // suggestion — createQuestion derives answerSource from this pair:
    // unchanged → 'llm_suggested', keeper-corrected → 'llm_edited'.
    verified: !input.machineDraftAnswer || input.machineDraftAnswer === input.answer,
    llmSuggestedAnswer: input.machineDraftAnswer ?? input.answer,
    critiqueIterations: 0,
    publicStatus: publicScoring.publicStatus,
    publicEligibilityScore: publicScoring.publicEligibilityScore,
    publicEligibilityReason: publicScoring.publicEligibilityReason,
    ...(blockedVisibility ? { visibility: blockedVisibility } : {}),
  });

  if (blockedVisibility) {
    return { ok: false, reason: 'failed_content_check', id: created.id };
  }
  return {
    ok: true,
    id: created.id,
    publicStatus: publicScoring.publicStatus,
    vetReason: publicScoring.publicEligibilityReason,
  };
}
