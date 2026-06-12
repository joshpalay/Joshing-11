/**
 * Answer grading — LLM primary, exact-match fast-path for obvious hits.
 * PRD 8.9: answers graded immediately on submission; result shown in session UI.
 * PRD 9.3: case insensitivity, accepted_alternatives treated as correct.
 * PRD 9 / Prompt 1: lenient grader via Haiku (claude-haiku-4-5, per CLAUDE.md —
 * Haiku for grading/categorization, Sonnet for generation); on infra failure the
 * grader returns an UNSCORED outcome (no `result`), never a 'wrong' verdict.
 */

import { gradeAnswerWithLLM } from '@/lib/llm';

// Mirrors questionTypeEnum in src/server/db/schema.ts. The grader's leniency
// policy branches on this (a 'personal' question's canonical answer is the
// creator's intended answer, not objective truth), so callers MUST pass the
// question's stored type — there is deliberately no default. Generated bot
// questions (generatedQuestions has no question_type column) are factual by
// construction and pass the literal 'factual'.
export type GradableQuestionType = 'factual' | 'personal' | 'ambiguous' | 'factual_uncertain';

export type GradeResult = 'correct' | 'wrong';

// A genuine, scored verdict — exact-match hit/miss or a real model judgement.
// `result` is meaningful and may be acted on: a 'wrong' here is a real wrong.
export type ScoredGrade = {
  status: 'scored';
  result: GradeResult;
  // "Snarky but Sweet" consolation for thematically-close wrong answers (null otherwise)
  consolation: string | null;
  // 0..1 from the LLM, or 1 for exact-match.
  confidence: number;
  // 'exact' — exact-match fast-path; 'llm' — model verdict. Retained for
  // analytics; it is NO LONGER the only thing standing between an outage and a
  // wrong score (that is now the `status` discriminant below).
  gradedVia: 'exact' | 'llm';
};

// The grader could not reach a verdict (timeout, parse error, no client). This
// is an infrastructure event, NOT a judgement of the answer, so it carries no
// `result` field — accessing `.result` here is a compile error. Routes MUST
// branch on `status === 'unscored'` and hold the answer for retry rather than
// persist a verdict the model never gave.
export type UnscoredGrade = {
  status: 'unscored';
  reason: string;
};

export type GradeOutcome = ScoredGrade | UnscoredGrade;

/**
 * Normalize an answer for the deterministic fast-path: lower-case, strip
 * diacritics, drop punctuation, collapse whitespace, and remove a single
 * leading article. This is deliberately conservative — it only ever causes the
 * fast-path to fire (returning `correct`) when two answers are character-for-
 * character the same once trivial differences are removed, so it cannot
 * manufacture a false `correct` for a genuinely different answer. A leading
 * article is dropped (e.g. "The Eroica" ≡ "Eroica") but interior articles are
 * kept so distinct answers like "Vitamin A" don't collapse onto "Vitamin".
 */
function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics: "Beyoncé" → "Beyonce"
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation → space: "J.S. Bach" → "j s bach"
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, ''); // drop a single leading article
}

/**
 * Fast-path exact match before calling the LLM. Returns true if the submission
 * is the same answer as the canonical (or an accepted alternative) once trivial
 * differences — case, diacritics, punctuation, whitespace, a leading article —
 * are normalized away. Catching these here skips the blocking LLM round-trip for
 * the common "right answer, slightly different spelling" case.
 */
function exactMatch(
  submitted: string,
  canonicalAnswer: string,
  acceptedAlternatives: string[]
): boolean {
  const normalized = normalizeForMatch(submitted);
  if (!normalized) return false;
  if (normalized === normalizeForMatch(canonicalAnswer)) return true;
  return acceptedAlternatives.some((alt) => normalizeForMatch(alt) === normalized);
}

/**
 * Side-effect-only telemetry for the fast-path hit rate (B-GRADE-FASTPATH-01).
 * `graded_via: 'exact'` means the submission short-circuited before the LLM;
 * `'llm'` means it paid for a model round-trip. Aggregating these in logs turns
 * the diagnosis's estimated hit rate into a measured one. Never let a logging
 * failure escape into the grade path — a missing log must not degrade grading.
 */
function logGrade(
  startedAt: number,
  gradedVia: 'exact' | 'llm',
  empty: boolean,
  outcome: GradeOutcome,
): GradeOutcome {
  try {
    console.info('[grade]', {
      graded_via: gradedVia,
      empty,
      status: outcome.status,
      result: outcome.status === 'scored' ? outcome.result : undefined,
      duration_ms: Date.now() - startedAt,
    });
  } catch {
    // telemetry only — swallow
  }
  return outcome;
}

/**
 * Grade a submitted answer.
 * Uses exact-match fast-path first, then LLM for nuanced cases.
 * Returns the result and an optional consolation quip for near-miss wrong answers.
 */
export async function gradeAnswer(
  submitted: string,
  canonicalAnswer: string,
  acceptedAlternatives: string[],
  questionText: string,
  questionType: GradableQuestionType
): Promise<GradeOutcome> {
  const startedAt = Date.now();

  // An empty submission is a genuine, deliberate wrong — a real scored verdict,
  // not an infra failure. (The daily give-up path is the analogous deliberate
  // wrong on its own route.)
  if (!submitted.trim()) {
    return logGrade(startedAt, 'exact', true, {
      status: 'scored', result: 'wrong', consolation: null, confidence: 1, gradedVia: 'exact',
    });
  }

  // Fast-path: skip the LLM for obvious exact matches and accepted alternatives
  if (exactMatch(submitted, canonicalAnswer, acceptedAlternatives)) {
    return logGrade(startedAt, 'exact', false, {
      status: 'scored', result: 'correct', consolation: null, confidence: 1, gradedVia: 'exact',
    });
  }

  const llmResult = await gradeAnswerWithLLM(
    questionText,
    canonicalAnswer,
    submitted,
    questionType,
    acceptedAlternatives
  ).catch((error): UnscoredGrade => {
    console.warn('[grading] LLM grading call failed; holding answer unscored', {
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    return { status: 'unscored', reason: 'llm_error' };
  });

  // Infra failure (timeout, parse error, no client) — never a scored verdict.
  if (llmResult.status === 'unscored') {
    return logGrade(startedAt, 'llm', false, { status: 'unscored', reason: llmResult.reason });
  }

  return logGrade(startedAt, 'llm', false, {
    status: 'scored',
    result: llmResult.result,
    consolation: llmResult.consolation ?? null,
    confidence: llmResult.confidence,
    gradedVia: 'llm',
  });
}
