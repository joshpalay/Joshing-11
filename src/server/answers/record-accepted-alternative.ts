/**
 * Fix 2 (recheck write-back) — fold an accepted appeal's alternative answer into
 * the question's stored answer key so the SAME correct-but-unlisted answer never
 * has to be appealed twice.
 *
 * Background: the first-pass grader (src/server/grading.ts) grades a submission
 * ONLY against the canonical answer + accepted_alternatives — it never reasons
 * about whether some other answer would also be correct for the question. When a
 * question has more than one genuinely-correct answer but only one is encoded
 * (e.g. "remove Data's arm" vs "shut Data off"), a correct answer to the
 * OTHER valid response is marked wrong until a human/LLM appeal (recheck) accepts
 * it. The recheck routes used to record that accepted alternative only on the
 * GradeDispute row (status 'alternative_added') — the answer key itself was never
 * updated, so the next player giving the same answer was wronged again. This
 * helper closes that loop: an accepted recheck appends the alternative to the
 * question's answer key, making the fix permanent and global.
 *
 * Best-effort by contract: it never throws (a write-back failure must not turn an
 * accepted recheck into an error for the player), and it dedups against the
 * existing key using the SAME normalization the fast-path grader uses, so it can
 * never add an entry the grader would already have matched.
 */

import { eq } from 'drizzle-orm';

import { db, generatedQuestions, questions } from '@/server/db';
import { normalizeForMatch } from '@/server/grading';

// An accepted-alternative is an ANSWER KEY entry, not a sentence. The recheck
// reviewer is asked to return the submission "normalized for future accepted
// alternatives", but defend against a runaway value polluting the key (and, with
// it, every future grade's leniency surface).
const MAX_ALTERNATIVE_LENGTH = 120;

/** Append `candidate` to `existing` unless the answer + existing entries already
 *  cover it under fast-path normalization. Returns the new array, or null when
 *  nothing should change. */
function withAlternative(
  answer: string,
  existing: string[],
  candidate: string,
): string[] | null {
  const norm = normalizeForMatch(candidate);
  if (!norm) return null;
  const known = new Set<string>([normalizeForMatch(answer), ...existing.map(normalizeForMatch)]);
  if (known.has(norm)) return null;
  return [...existing, candidate];
}

/**
 * Persist an accepted recheck's alternative into the question's answer key.
 *
 * Writes the canonical `Question.accepted_alternatives` (what feed/milestone and
 * cross-surface grading read) and, when the recheck resolved a bot question, the
 * originating `GeneratedQuestion.acceptable_variants` too (what the live daily
 * path grades against before promotion). Both writes dedup independently.
 */
export async function recordAcceptedAlternative(params: {
  canonicalQuestionId: string | null;
  generatedQuestionId?: string | null;
  alternative: string | null | undefined;
}): Promise<void> {
  const candidate = params.alternative?.trim();
  if (!candidate || candidate.length > MAX_ALTERNATIVE_LENGTH) return;

  try {
    if (params.canonicalQuestionId) {
      const [row] = await db
        .select({
          answerText: questions.answerText,
          acceptedAlternatives: questions.acceptedAlternatives,
        })
        .from(questions)
        .where(eq(questions.id, params.canonicalQuestionId))
        .limit(1);
      if (row) {
        const next = withAlternative(row.answerText, row.acceptedAlternatives ?? [], candidate);
        if (next) {
          await db
            .update(questions)
            .set({ acceptedAlternatives: next, updatedAt: new Date() })
            .where(eq(questions.id, params.canonicalQuestionId));
        }
      }
    }

    if (params.generatedQuestionId) {
      const [row] = await db
        .select({
          answer: generatedQuestions.answer,
          acceptableVariants: generatedQuestions.acceptableVariants,
        })
        .from(generatedQuestions)
        .where(eq(generatedQuestions.id, params.generatedQuestionId))
        .limit(1);
      if (row) {
        const next = withAlternative(row.answer, row.acceptableVariants ?? [], candidate);
        if (next) {
          await db
            .update(generatedQuestions)
            .set({ acceptableVariants: next })
            .where(eq(generatedQuestions.id, params.generatedQuestionId));
        }
      }
    }
  } catch (error) {
    // Best-effort: the player already saw their answer accepted. A failed
    // write-back just means the next player with the same answer appeals again —
    // never surface it as a recheck failure.
    console.warn('[recordAcceptedAlternative] write-back failed', {
      canonicalQuestionId: params.canonicalQuestionId,
      generatedQuestionId: params.generatedQuestionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
